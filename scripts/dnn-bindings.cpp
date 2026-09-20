#include <opencv2/dnn/layer.hpp>

namespace DNNBridge {
    using emscripten::val;
    using CallbackBridge::call;
    using CallbackBridge::BorrowedMats;
    std::map<std::string, val> factories;

    val parameters(const cv::dnn::LayerParams& params) {
        auto result = val::object();
        for (const auto& [key, value] : params) {
            auto items = val::array();
            for (int i = 0; i < value.size(); ++i) {
                if (value.isString()) items.set(i, value.get<cv::String>(i));
                else if (value.isInt()) items.set(i, value.get<int64_t>(i));
                else items.set(i, value.get<double>(i));
            }
            result.set(key, value.size() == 1 ? items[0] : items);
        }
        return result;
    }

    class Layer : public cv::dnn::Layer {
        val implementation;
    public:
        Layer(const cv::dnn::LayerParams& params, const val& factory) : cv::dnn::Layer(params), implementation(val::undefined()) {
            BorrowedMats blobs(params.blobs);
            auto config = val::object();
            config.set("name", params.name);
            config.set("type", params.type);
            config.set("params", parameters(params));
            config.set("blobs", blobs.values);
            auto args = val::array();
            args.set(0, config);
            implementation = call(factory, val::undefined(), args);
            CV_Assert(!implementation.isNull() && !implementation.isUndefined());
            CV_Assert(implementation["getMemoryShapes"].typeOf().as<std::string>() == "function");
            CV_Assert(implementation["forward"].typeOf().as<std::string>() == "function");
        }
        bool supportBackend(int backend) CV_OVERRIDE { return backend == cv::dnn::DNN_BACKEND_OPENCV; }
        bool getMemoryShapes(const std::vector<cv::MatShape>& inputs, int required,
                             std::vector<cv::MatShape>& outputs, std::vector<cv::MatShape>& internals) const CV_OVERRIDE {
            auto shapes = val::array();
            for (unsigned i = 0; i < inputs.size(); ++i) {
                auto shape = val::array();
                for (unsigned j = 0; j < inputs[i].size(); ++j) shape.set(j, inputs[i][j]);
                shapes.set(i, shape);
            }
            auto args = val::array();
            args.set(0, shapes);
            auto result = call(implementation["getMemoryShapes"], implementation, args);
            const auto count = result["length"].as<unsigned>();
            CV_Assert(count > 0 && count >= static_cast<unsigned>(std::max(required, 0)));
            outputs.clear();
            internals.clear();
            for (unsigned i = 0; i < count; ++i) {
                auto shape = emscripten::vecFromJSArray<int>(result[i]);
                CV_Assert(!shape.empty() && std::all_of(shape.begin(), shape.end(), [](int size) { return size > 0; }));
                outputs.emplace_back(shape);
            }
            return false;
        }
        void forward(cv::InputArrayOfArrays inputs, cv::OutputArrayOfArrays outputs, cv::OutputArrayOfArrays) CV_OVERRIDE {
            std::vector<cv::Mat> inputMats, outputMats;
            inputs.getMatVector(inputMats);
            outputs.getMatVector(outputMats);
            BorrowedMats source(inputMats), destination(outputMats);
            auto args = val::array();
            args.set(0, source.values);
            args.set(1, destination.values);
            CV_Assert(call(implementation["forward"], implementation, args).isUndefined());
        }
    };

    cv::Ptr<cv::dnn::Layer> create(cv::dnn::LayerParams& params) {
        const auto factory = factories.find(params.type);
        CV_Assert(factory != factories.end());
        return cv::makePtr<Layer>(params, factory->second);
    }
}

EMSCRIPTEN_BINDINGS(dnn_callbacks) {
    emscripten::function("dnn_registerLayer", +[](const std::string& type, const emscripten::val& factory) {
        CV_Assert(!type.empty() && factory.typeOf().as<std::string>() == "function");
        CV_Assert(DNNBridge::factories.count(type) == 0);
        cv::dnn::LayerFactory::registerLayer(type, &DNNBridge::create);
        DNNBridge::factories.emplace(type, factory);
    });
    emscripten::function("dnn_unregisterLayer", +[](const std::string& type) {
        if (DNNBridge::factories.erase(type)) cv::dnn::LayerFactory::unregisterLayer(type);
    });
}
