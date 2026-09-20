#include <opencv2/gapi/cpu/gcpukernel.hpp>

namespace GraphKernels {
    using emscripten::val;

    val describe(const cv::GMatDesc& descriptor) {
        auto result = val::object();
        result.set("depth", descriptor.depth);
        result.set("channels", descriptor.chan);
        result.set("size", descriptor.size);
        result.set("planar", descriptor.planar);
        auto dims = val::array();
        for (unsigned i = 0; i < descriptor.dims.size(); ++i) dims.set(i, descriptor.dims[i]);
        result.set("dims", dims);
        return result;
    }

    cv::GMatDesc descriptor(const val& value) {
        const int depth = value["depth"].as<int>(), channels = value["channels"].as<int>();
        CV_Assert(depth >= 0 && depth < CV_DEPTH_CURR_MAX);
        if (value.hasOwnProperty("dims") && value["dims"]["length"].as<unsigned>() > 0) {
            auto dims = emscripten::vecFromJSArray<int>(value["dims"]);
            CV_Assert(std::all_of(dims.begin(), dims.end(), [](int size) { return size > 0; }));
            return cv::GMatDesc(depth, dims);
        }
        const auto size = value["size"].as<cv::Size>();
        CV_Assert(channels > 0 && channels <= CV_CN_MAX && size.width > 0 && size.height > 0);
        return cv::GMatDesc(depth, channels, size, value.hasOwnProperty("planar") && value["planar"].as<bool>());
    }

    class Functor final : public cv::gapi::GFunctor {
        cv::GKernelImpl implementation;
    public:
        Functor(const std::string& id, cv::GKernelImpl impl) : GFunctor(id.c_str()), implementation(std::move(impl)) {}
        cv::GKernelImpl impl() const CV_OVERRIDE { return implementation; }
        cv::gapi::GBackend backend() const CV_OVERRIDE { return cv::gapi::cpu::backend(); }
    };

    class Operation {
        std::string id;
        unsigned inputCount, outputCount;
        cv::GKernel::M metadata;
    public:
        Operation(const std::string& name, unsigned inputs, unsigned outputs, const val& outMeta)
            : id(name), inputCount(inputs), outputCount(outputs) {
            CV_Assert(!name.empty() && inputs > 0 && outputs > 0);
            CV_Assert(outMeta.typeOf().as<std::string>() == "function");
            metadata = [outMeta, inputs, outputs](const cv::GMetaArgs& meta, const cv::GArgs&) {
                CV_Assert(meta.size() == inputs);
                auto arguments = val::array(), values = val::array();
                for (unsigned i = 0; i < meta.size(); ++i) values.set(i, describe(cv::util::get<cv::GMatDesc>(meta[i])));
                arguments.set(0, values);
                auto result = CallbackBridge::call(outMeta, val::undefined(), arguments);
                CV_Assert(!result.isNull() && !result.isUndefined() && result["length"].as<unsigned>() == outputs);
                cv::GMetaArgs descriptions;
                for (unsigned i = 0; i < outputs; ++i) descriptions.emplace_back(descriptor(result[i]));
                return descriptions;
            };
        }

        val on(const val& inputs) const {
            CV_Assert(inputs["length"].as<unsigned>() == inputCount);
            cv::GKernel kernel{id, {}, metadata,
                cv::GShapes(outputCount, cv::GShape::GMAT),
                cv::GKinds(inputCount, cv::detail::OpaqueKind::CV_UNKNOWN),
                cv::GCtors(outputCount),
                cv::GKinds(outputCount, cv::detail::OpaqueKind::CV_UNKNOWN)};
            cv::GCall call(std::move(kernel));
            cv::GArgs args;
            for (unsigned i = 0; i < inputCount; ++i) args.emplace_back(inputs[i].as<cv::GMat>());
            call.setArgs(std::move(args));
            auto result = val::array();
            for (unsigned i = 0; i < outputCount; ++i) result.set(i, call.yield(i));
            return result;
        }

        cv::GKernelPackage kernel(const val& run) const {
            CV_Assert(run.typeOf().as<std::string>() == "function");
            const auto inputs = inputCount, outputs = outputCount;
            cv::GCPUKernel implementation([run, inputs, outputs](cv::GCPUContext& context) {
                std::vector<cv::Mat> source, destination;
                for (unsigned i = 0; i < inputs; ++i) source.push_back(context.inMat(i));
                for (unsigned i = 0; i < outputs; ++i) destination.push_back(context.outMatR(i));
                CallbackBridge::BorrowedMats inputMats(source), outputMats(destination);
                auto args = val::array();
                args.set(0, inputMats.values);
                args.set(1, outputMats.values);
                CV_Assert(CallbackBridge::call(run, val::undefined(), args).isUndefined());
            });
            cv::GKernelPackage result;
            result.include(Functor(id, cv::GKernelImpl{implementation, metadata}));
            return result;
        }
    };
}

EMSCRIPTEN_BINDINGS(graph_callbacks) {
    emscripten::class_<GraphKernels::Operation>("GOperation")
        .constructor<const std::string&, unsigned, unsigned, const emscripten::val&>()
        .function("on", &GraphKernels::Operation::on)
        .function("kernel", &GraphKernels::Operation::kernel);
    emscripten::function("gapi_matDesc", +[](const cv::Mat& image) { return GraphKernels::describe(cv::descr_of(image)); });
    emscripten::function("gapi_emptyKernels", +[]() { return cv::GKernelPackage(); });
}
