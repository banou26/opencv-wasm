#include <opencv2/gapi.hpp>
#include <opencv2/gapi/garg.hpp>
#include <opencv2/gapi/cpu/core.hpp>
#include <opencv2/gapi/cpu/imgproc.hpp>
#include <opencv2/gapi/fluid/core.hpp>
#include <opencv2/gapi/fluid/imgproc.hpp>
#include <opencv2/gapi/render/render.hpp>
#include <opencv2/gapi/streaming/meta.hpp>

namespace GraphBridge {
    cv::gapi::wip::draw::Prims primitives(const emscripten::val& values) {
        cv::gapi::wip::draw::Prims result;
        for (unsigned i = 0; i < values["length"].as<unsigned>(); ++i) {
            const auto value = values[i];
            @DRAW_PRIMITIVES@
            else CV_Error(cv::Error::StsBadArg, "Expected a native drawing primitive");
        }
        return result;
    }
    cv::GProtoArgs prototype(const emscripten::val& values) {
        cv::GProtoArgs args;
        const auto length = values["length"].as<unsigned>();
        for (unsigned i = 0; i < length; ++i) {
            const auto value = values[i];
            if (value.instanceof(emscripten::val::module_property("GMat"))) args.emplace_back(value.as<cv::GMat>());
            else if (value.instanceof(emscripten::val::module_property("GScalar"))) args.emplace_back(value.as<cv::GScalar>());
            else if (value.instanceof(emscripten::val::module_property("GFrame"))) args.emplace_back(value.as<cv::GFrame>());
            @GRAPH_PROTOTYPES@
            else CV_Error(cv::Error::StsBadArg, "Expected a graph data object");
        }
        return args;
    }

    template<class T> cv::GRunArg unpack(const emscripten::val& value, bool array) {
        if (array) return cv::GRunArg(cv::detail::VectorRef(emscripten::vecFromJSArray<T>(value)));
        if constexpr (std::is_same_v<T, cv::Mat> || std::is_same_v<T, cv::Scalar>) CV_Error(cv::Error::StsBadArg, "Use GMat or GScalar for this input");
        else return cv::GRunArg(cv::detail::OpaqueRef(value.as<T>()));
    }

    cv::GRunArgs inputs(const emscripten::val& values, const cv::GTypesInfo& types) {
        CV_Assert(values["length"].as<unsigned>() == types.size());
        cv::GRunArgs args;
        for (unsigned i = 0; i < types.size(); ++i) {
            const auto value = values[i];
            const auto& type = types[i];
            if (type.shape == cv::GShape::GMAT) args.emplace_back(value.as<cv::Mat>());
            else if (type.shape == cv::GShape::GSCALAR) args.emplace_back(value.as<cv::Scalar>());
            else {
                const bool array = type.shape == cv::GShape::GARRAY;
                switch (type.kind) {
                    @GRAPH_INPUTS@
                    default: CV_Error(cv::Error::StsNotImplemented, "Unsupported graph input kind");
                }
            }
        }
        return args;
    }

    template<class T> emscripten::val pack(const cv::GRunArg& value, bool array) {
        if (array) {
            const auto& items = cv::util::get<cv::detail::VectorRef>(value).rref<T>();
            auto result = emscripten::val::array();
            for (unsigned i = 0; i < items.size(); ++i) result.set(i, T(items[i]));
            return result;
        }
        if constexpr (std::is_same_v<T, cv::Mat> || std::is_same_v<T, cv::Scalar>) CV_Error(cv::Error::StsBadArg, "Expected matrix or scalar output");
        else return emscripten::val(cv::util::get<cv::detail::OpaqueRef>(value).rref<T>());
    }

    emscripten::val outputs(const cv::GRunArgs& args) {
        auto result = emscripten::val::array();
        for (unsigned i = 0; i < args.size(); ++i) {
            const auto& arg = args[i];
            if (cv::util::holds_alternative<cv::Mat>(arg)) result.set(i, cv::util::get<cv::Mat>(arg));
            else if (cv::util::holds_alternative<cv::Scalar>(arg)) result.set(i, cv::util::get<cv::Scalar>(arg));
            else {
                const bool array = cv::util::holds_alternative<cv::detail::VectorRef>(arg);
                const auto kind = array ? cv::util::get<cv::detail::VectorRef>(arg).getKind() : cv::util::get<cv::detail::OpaqueRef>(arg).getKind();
                switch (kind) {
                    @GRAPH_OUTPUTS@
                    default: CV_Error(cv::Error::StsNotImplemented, "Unsupported graph output kind");
                }
            }
        }
        return result;
    }

    emscripten::val apply(cv::GComputation& computation, const emscripten::val& values, cv::GCompileArgs options,
                          const emscripten::val& metadata = emscripten::val::undefined()) {
        cv::detail::ExtractArgsCallback callback{[values, metadata](const cv::GTypesInfo& types) {
            auto args = inputs(values, types);
            if (!metadata.isUndefined()) {
                for (const auto* name : {"seqId", "timestamp"}) {
                    const auto value = metadata[name];
                    CV_Assert(value.typeOf().as<std::string>() == "bigint");
                    CV_Assert(value.strictlyEquals(emscripten::val::global("BigInt").call<emscripten::val>("asIntN", 64, value)));
                }
                const int64_t sequence = metadata["seqId"].as<int64_t>();
                const int64_t timestamp = metadata["timestamp"].as<int64_t>();
                for (auto& arg : args) {
                    arg.meta[cv::gapi::streaming::meta_tag::seq_id] = sequence;
                    arg.meta[cv::gapi::streaming::meta_tag::timestamp] = timestamp;
                }
            }
            return args;
        }};
        return outputs(computation.apply(callback, std::move(options)));
    }
}

EMSCRIPTEN_BINDINGS(graph_execution) {
    emscripten::class_<cv::gapi::wip::draw::Prim>("GDrawPrim")
        .class_function("fromText", +[](const cv::gapi::wip::draw::Text& value) { return cv::gapi::wip::draw::Prim(value); })
        .class_function("fromRect", +[](const cv::gapi::wip::draw::Rect& value) { return cv::gapi::wip::draw::Prim(value); })
        .class_function("fromCircle", +[](const cv::gapi::wip::draw::Circle& value) { return cv::gapi::wip::draw::Prim(value); })
        .class_function("fromLine", +[](const cv::gapi::wip::draw::Line& value) { return cv::gapi::wip::draw::Prim(value); })
        .class_function("fromMosaic", +[](const cv::gapi::wip::draw::Mosaic& value) { return cv::gapi::wip::draw::Prim(value); })
        .class_function("fromImage", +[](const cv::gapi::wip::draw::Image& value) { return cv::gapi::wip::draw::Prim(value); })
        .class_function("fromPoly", +[](const cv::gapi::wip::draw::Poly& value) { return cv::gapi::wip::draw::Prim(value); });
    emscripten::function("gapi_wip_draw_render", +[](cv::Mat& image, const emscripten::val& primitives) { cv::gapi::wip::draw::render(image, GraphBridge::primitives(primitives)); });
    emscripten::function("gapi_wip_draw_render1", +[](cv::Mat& y, cv::Mat& uv, const emscripten::val& primitives) { cv::gapi::wip::draw::render(y, uv, GraphBridge::primitives(primitives)); });
    emscripten::class_<cv::GProtoInputArgs>("GProtoInputArgs");
    emscripten::class_<cv::GProtoOutputArgs>("GProtoOutputArgs");
    emscripten::function("GIn", +[](const emscripten::val& values) { return cv::GProtoInputArgs(GraphBridge::prototype(values)); });
    emscripten::function("GOut", +[](const emscripten::val& values) { return cv::GProtoOutputArgs(GraphBridge::prototype(values)); });
    emscripten::class_<cv::GCompileArg>("GCompileArg")
        .constructor<cv::GKernelPackage>()
        .class_function("fromNetworks", +[](const cv::gapi::GNetPackage& networks) { return cv::GCompileArg(networks); })
        .class_function("fromQueueCapacity", +[](const cv::gapi::streaming::queue_capacity& capacity) { return cv::GCompileArg(capacity); });
    emscripten::register_vector<cv::GCompileArg>("GCompileArgs");
    emscripten::class_<cv::GComputation>("GComputation")
        .constructor(+[](const cv::GProtoInputArgs& inputs, const cv::GProtoOutputArgs& outputs) {
            return new cv::GComputation(cv::GProtoInputArgs(inputs), cv::GProtoOutputArgs(outputs));
        })
        .class_function("fromMatrices", +[](const cv::GMat& input, const cv::GMat& output) { return cv::makePtr<cv::GComputation>(input, output); })
        .smart_ptr<cv::Ptr<cv::GComputation>>("Ptr_GComputation")
        .function("apply", +[](cv::GComputation& self, const emscripten::val& inputs) { return GraphBridge::apply(self, inputs, {}); })
        .function("apply", +[](cv::GComputation& self, const emscripten::val& inputs, const cv::GCompileArgs& options) { return GraphBridge::apply(self, inputs, options); })
        .function("applyWithMetadata", +[](cv::GComputation& self, const emscripten::val& inputs, const emscripten::val& metadata) { return GraphBridge::apply(self, inputs, {}, metadata); })
        .function("applyWithMetadata", +[](cv::GComputation& self, const emscripten::val& inputs, const emscripten::val& metadata, const cv::GCompileArgs& options) { return GraphBridge::apply(self, inputs, options, metadata); });
    emscripten::function("gapi_streaming_timestamp", +[](const cv::GMat& input) { return cv::gapi::streaming::timestamp(input); });
    emscripten::function("gapi_streaming_seq_id", +[](const cv::GMat& input) { return cv::gapi::streaming::seq_id(input); });
    emscripten::function("gapi_streaming_seqNo", +[](const cv::GMat& input) { return cv::gapi::streaming::seqNo(input); });
}
