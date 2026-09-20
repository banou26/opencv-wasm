#include <opencv2/gapi/infer.hpp>
#include <set>
#include "api/gbackend_priv.hpp"

// The backend attaches DNN kernels to the actual upstream infer operations and
// delegates their scheduling and buffer ownership to G-API's CPU executor.
namespace GraphDNN {
    enum class Mode { Tensor, ROI, List, List2 };
    cv::gapi::GBackend backend();

    struct Input {
        cv::Size size;
        double scale = 1.;
        cv::Scalar mean;
        bool swapRB = false, crop = false;
    };

    struct Params {
        std::string tag;
        cv::dnn::Net net;
        std::map<std::string, Input> inputs;
        Params(const std::string& name, const cv::dnn::Net& network) : tag(name), net(network) {
            CV_CheckFalse(tag.empty(), "Network tag must not be empty");
            CV_CheckFalse(net.empty(), "Network must contain layers");
            if (!net.getMainGraph()) {
                net.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
                net.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
            }
        }
        int inputIndex(const std::string& name) const {
            const auto graph = net.getMainGraph();
            if (!graph) return net.getLayer(0)->outputNameToIndex(name);
            const auto& arguments = graph->inputs();
            for (unsigned i = 0; i < arguments.size(); ++i)
                if (net.argName(arguments[i]) == name) return static_cast<int>(i);
            return -1;
        }
        void cfgInput(const std::string& name, const emscripten::val& options) {
            CV_CheckGE(inputIndex(name), 0, "Unknown network input name");
            Input config;
            config.size = options["size"].as<cv::Size>();
            CV_Assert(config.size.width > 0 && config.size.height > 0);
            if (options.hasOwnProperty("scale")) config.scale = options["scale"].as<double>();
            if (options.hasOwnProperty("mean")) config.mean = options["mean"].as<cv::Scalar>();
            if (options.hasOwnProperty("swapRB")) config.swapRB = options["swapRB"].as<bool>();
            if (options.hasOwnProperty("crop")) config.crop = options["crop"].as<bool>();
            CV_Assert(std::isfinite(config.scale));
            inputs[name] = config;
        }
    };

    struct Unit {
        Params params;
        cv::detail::InOutInfo info;
        Mode mode;
        bool newEngine;
        cv::GKinds kinds;
        std::vector<int> inputIndices, outputIds;
        Unit(const Params& config, const cv::detail::InOutInfo& names, Mode operation, const cv::GKinds& types)
            : params(config), info(names), mode(operation), newEngine(bool(config.net.getMainGraph())), kinds(types) {
            CV_Assert(!info.in_names.empty() && !info.out_names.empty());
            for (const auto& name : info.in_names) {
                int index = params.inputIndex(name);
                CV_CheckGE(index, 0, "Unknown network input name");
                inputIndices.push_back(index);
            }
            auto sorted = inputIndices;
            std::sort(sorted.begin(), sorted.end());
            for (unsigned i = 0; i < sorted.size(); ++i) CV_CheckEQ(sorted[i], static_cast<int>(i), "Provide every network input");
            if (newEngine) CV_CheckEQ(inputIndices.size(), params.net.getMainGraph()->inputs().size(), "Provide every network input");
            for (const auto& name : info.out_names) {
                int id = -1;
                if (newEngine) {
                    const auto& outputs = params.net.getMainGraph()->outputs();
                    for (unsigned i = 0; i < outputs.size(); ++i)
                        if (params.net.argName(outputs[i]) == name) id = static_cast<int>(i);
                    CV_CheckGE(id, 0, "Unknown network output name");
                } else {
                    id = params.net.getLayerId(name);
                    CV_CheckGT(id, 0, "Unknown network output name");
                }
                outputIds.push_back(id);
            }
            if (mode == Mode::ROI || mode == Mode::List) {
                CV_CheckEQ(info.in_names.size(), size_t(1), "Region inference requires a single-input network");
                CV_CheckEQ(params.inputs.count(info.in_names[0]), size_t(1), "Region inference requires cfgInput preprocessing");
            }
        }

        cv::MatShape shape(const cv::GMatDesc& meta, const std::string& name) const {
            auto config = params.inputs.find(name);
            if (config != params.inputs.end()) {
                CV_Assert(meta.dims.empty() && !meta.planar && (meta.depth == CV_8U || meta.depth == CV_32F));
                CV_Assert(meta.chan == 1 || meta.chan == 3 || meta.chan == 4);
                return cv::MatShape{1, meta.chan, config->second.size.height, config->second.size.width};
            }
            CV_Assert(meta.depth == CV_32F && !meta.planar);
            if (!meta.dims.empty()) return cv::MatShape(meta.dims);
            CV_CheckEQ(meta.chan, 1, "Raw tensor inputs must have one channel");
            return cv::MatShape{meta.size.height, meta.size.width};
        }

        cv::GMetaArgs metadata(const cv::GMetaArgs& meta) {
            if (mode == Mode::List || mode == Mode::List2) return cv::GMetaArgs(info.out_names.size(), cv::GMetaArg(cv::GArrayDesc{}));
            std::vector<cv::MatShape> inputs(info.in_names.size());
            const unsigned offset = mode == Mode::Tensor ? 0 : 1;
            for (unsigned i = 0; i < info.in_names.size(); ++i)
                inputs.at(inputIndices[i]) = shape(cv::util::get<cv::GMatDesc>(meta.at(i + offset)), info.in_names[i]);
            cv::GMetaArgs result;
            std::vector<cv::MatShape> allOutputs;
            if (newEngine) {
                std::vector<cv::MatShape> in;
                params.net.getLayerShapes(inputs, std::vector<int>(inputs.size(), CV_32F), 0, in, allOutputs);
            }
            for (int id : outputIds) {
                std::vector<cv::MatShape> in, out;
                if (newEngine) out.push_back(allOutputs.at(id));
                else params.net.getLayerShapes(inputs, std::vector<int>(inputs.size(), CV_32F), id, in, out);
                CV_Assert(!out.empty() && !out[0].empty());
                CV_Assert(std::all_of(out[0].begin(), out[0].end(), [](int n) { return n > 0; }));
                if (out[0].size() == 2) result.emplace_back(cv::GMatDesc(CV_32F, 1, cv::Size(out[0][1], out[0][0])));
                else result.emplace_back(cv::GMatDesc(CV_32F, out[0].vec()));
            }
            return result;
        }

        cv::Mat tensor(const cv::Mat& image, const std::string& name, bool raw = false) const {
            auto config = params.inputs.find(name);
            if (raw || config == params.inputs.end()) {
                CV_CheckTypeEQ(image.type(), CV_32FC1, "Raw tensor inputs must be CV_32FC1");
                return image;
            }
            const auto& p = config->second;
            return cv::dnn::blobFromImage(image, p.scale, p.size, p.mean, p.swapRB, p.crop, CV_32F);
        }

        cv::Mat region(const cv::Mat& image, const cv::Rect& rect, const std::string& name) const {
            CV_Assert(params.inputs.count(name) == 1);
            CV_Assert(image.dims == 2 && rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0);
            CV_Assert(rect.width <= image.cols && rect.height <= image.rows);
            CV_Assert(rect.x <= image.cols - rect.width && rect.y <= image.rows - rect.height);
            return tensor(image(rect), name);
        }

        std::vector<cv::Mat> forward(const std::vector<cv::Mat>& tensors) {
            CV_Assert(tensors.size() == info.in_names.size());
            for (unsigned i = 0; i < tensors.size(); ++i) params.net.setInput(tensors[i], info.in_names[i]);
            std::vector<cv::Mat> result;
            params.net.forward(result, info.out_names);
            CV_Assert(result.size() == info.out_names.size());
            for (const auto& mat : result) CV_CheckTypeEQ(mat.type(), CV_32FC1, "Graph DNN outputs must be CV_32FC1");
            return result;
        }

        void run(cv::GCPUContext& ctx) {
            if (mode == Mode::Tensor || mode == Mode::ROI) {
                std::vector<cv::Mat> tensors;
                for (unsigned i = 0; i < info.in_names.size(); ++i) {
                    if (mode == Mode::Tensor) tensors.push_back(tensor(ctx.inMat(i), info.in_names[i]));
                    else tensors.push_back(region(ctx.inMat(1), cv::detail::get_in<cv::GOpaque<cv::Rect>>::get(ctx, 0), info.in_names[i]));
                }
                auto result = forward(tensors);
                for (unsigned i = 0; i < result.size(); ++i) {
                    auto& dest = ctx.outMatR(i);
                    CV_Assert(dest.type() == result[i].type() && dest.size == result[i].size);
                    result[i].copyTo(dest);
                }
                return;
            }

            size_t count = 0;
            if (mode == Mode::List) count = cv::detail::get_in<cv::GArray<cv::Rect>>::get(ctx, 0).size();
            else {
                for (unsigned i = 0; i < info.in_names.size(); ++i) {
                    const auto& values = ctx.inArg<cv::detail::VectorRef>(i + 1);
                    const size_t length = kinds.at(i + 1) == cv::detail::OpaqueKind::CV_RECT
                        ? values.rref<cv::Rect>().size() : values.rref<cv::Mat>().size();
                    if (i == 0) count = length;
                    else CV_CheckEQ(length, count, "Inference input lists must have equal lengths");
                }
            }
            std::vector<std::vector<cv::Mat>> outputs(info.out_names.size());
            for (size_t item = 0; item < count; ++item) {
                std::vector<cv::Mat> tensors;
                for (unsigned i = 0; i < info.in_names.size(); ++i) {
                    if (mode == Mode::List) {
                        const auto& rect = cv::detail::get_in<cv::GArray<cv::Rect>>::get(ctx, 0).at(item);
                        tensors.push_back(region(ctx.inMat(1), rect, info.in_names[i]));
                    } else if (kinds.at(i + 1) == cv::detail::OpaqueKind::CV_RECT) {
                        const auto& rect = cv::detail::get_in<cv::GArray<cv::Rect>>::get(ctx, i + 1).at(item);
                        tensors.push_back(region(ctx.inMat(0), rect, info.in_names[i]));
                    } else {
                        const auto& mat = cv::detail::get_in<cv::GArray<cv::Mat>>::get(ctx, i + 1).at(item);
                        tensors.push_back(tensor(mat, info.in_names[i], true));
                    }
                }
                auto result = forward(tensors);
                // Net::forward reuses its output buffers on the next item.
                for (unsigned i = 0; i < result.size(); ++i) outputs[i].push_back(result[i].clone());
            }
            for (unsigned i = 0; i < outputs.size(); ++i) ctx.outVecR<cv::Mat>(i) = std::move(outputs[i]);
        }
    };

    class Functor final : public cv::gapi::GFunctor {
        Mode mode;
    public:
        Functor(const char* id, Mode operation) : GFunctor(id), mode(operation) {}
        cv::GKernelImpl impl() const CV_OVERRIDE { return cv::GKernelImpl{mode, {}}; }
        cv::gapi::GBackend backend() const CV_OVERRIDE { return GraphDNN::backend(); }
    };

    class Backend final : public cv::gapi::GBackend::Priv {
        void unpackKernel(ade::Graph& graph, const ade::NodeHandle& node, const cv::GKernelImpl& impl) CV_OVERRIDE {
            cv::gimpl::GModel::Graph model(graph);
            const auto& op = model.metadata(node).get<cv::gimpl::Op>();
            ade::TypedGraph<cv::gimpl::NetworkParams> networks(graph);
            const auto& config = cv::util::any_cast<Params>(networks.metadata(node).get<cv::gimpl::NetworkParams>().opaque);
            auto unit = std::make_shared<Unit>(config, cv::util::any_cast<cv::detail::InOutInfo>(op.params), cv::util::any_cast<Mode>(impl.opaque), op.k.inKinds);
            model.metadata(node).set(cv::gimpl::CustomMetaFunction{[unit](const ade::Graph&, const ade::NodeHandle&, const cv::GMetaArgs& meta, const cv::GArgs&) {
                return unit->metadata(meta);
            }});
            cv::GCPUKernel kernel([unit](cv::GCPUContext& context) { unit->run(context); });
            cv::gapi::cpu::backend().priv().unpackKernel(graph, node, cv::GKernelImpl{kernel, {}});
        }
        EPtr compile(const ade::Graph& graph, const cv::GCompileArgs& args, const std::vector<ade::NodeHandle>& nodes) const CV_OVERRIDE {
            return cv::gapi::cpu::backend().priv().compile(graph, args, nodes);
        }
        cv::GKernelPackage auxiliaryKernels() const CV_OVERRIDE {
            cv::GKernelPackage result;
            result.include(Functor(cv::GInferBase::id(), Mode::Tensor));
            result.include(Functor(cv::GInferROIBase::id(), Mode::ROI));
            result.include(Functor(cv::GInferListBase::id(), Mode::List));
            result.include(Functor(cv::GInferList2Base::id(), Mode::List2));
            return result;
        }
    };

    cv::gapi::GBackend backend() {
        static cv::gapi::GBackend value(std::make_shared<Backend>());
        return value;
    }
}

EMSCRIPTEN_BINDINGS(graph_inference) {
    using emscripten::val;
    emscripten::class_<GraphDNN::Params>("gapi_dnn_Params")
        .constructor<const std::string&, const cv::dnn::Net&>()
        .function("cfgInput", &GraphDNN::Params::cfgInput);
    emscripten::function("gapi_networks", +[](const val& values) {
        std::vector<cv::gapi::GNetParam> networks;
        std::set<std::string> tags;
        for (unsigned i = 0; i < values["length"].as<unsigned>(); ++i) {
            auto params = values[i].as<GraphDNN::Params>();
            CV_Assert(tags.insert(params.tag).second);
            networks.push_back({params.tag, GraphDNN::backend(), params});
        }
        return cv::gapi::GNetPackage(std::move(networks));
    });
    emscripten::class_<cv::GInferInputs>("GInferInputs")
        .constructor<>()
        .function("setInput", +[](cv::GInferInputs& self, const std::string& name, const cv::GMat& value) { self[name] = cv::GMat(value); });
    emscripten::class_<cv::GInferListInputs>("GInferListInputs")
        .constructor<>()
        .function("setInput", +[](cv::GInferListInputs& self, const std::string& name, const val& value) {
            if (value.instanceof(val::module_property("GArray_Rect"))) self[name] = value.as<cv::GArray<cv::Rect>>();
            else self[name] = cv::GArray<cv::GMat>(value.as<cv::GArray<cv::Mat>>().strip());
        });
    emscripten::class_<cv::GInferOutputs>("GInferOutputs")
        .function("at", &cv::GInferOutputs::at);
    emscripten::class_<cv::GInferListOutputs>("GInferListOutputs")
        .function("at", +[](cv::GInferListOutputs& self, const std::string& name) { return cv::GArray<cv::Mat>(self.at(name).strip()); });
    emscripten::function("gapi_infer", +[](const std::string& tag, const cv::GInferInputs& inputs) { return cv::gapi::infer(tag, inputs); });
    emscripten::function("gapi_infer", +[](const std::string& tag, const val& region, const cv::GInferInputs& inputs) {
        if (region.instanceof(val::module_property("GOpaque_Rect"))) return val(cv::gapi::infer(tag, region.as<cv::GOpaque<cv::Rect>>(), inputs));
        return val(cv::gapi::infer(tag, region.as<cv::GArray<cv::Rect>>(), inputs));
    });
    emscripten::function("gapi_infer2", +[](const std::string& tag, const cv::GMat& image, const cv::GInferListInputs& inputs) { return cv::gapi::infer2(tag, image, inputs); });
}
