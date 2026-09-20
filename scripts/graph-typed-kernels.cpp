namespace TypedGraph {
    using emscripten::val;

    struct BorrowedHandles {
        std::vector<val> handles;
        template<class T> val add(const T& value) {
            val handle(value);
            handles.push_back(handle);
            return handle;
        }
        ~BorrowedHandles() {
            for (auto& handle : handles) if (!handle.call<bool>("isDeleted")) handle.call<void>("delete");
        }
    };

    template<class T> struct Vector : std::false_type {};
    template<class T> struct Vector<std::vector<T>> : std::true_type { using Element = T; };

    template<class T> void validate(const val& value) {
        if constexpr (Vector<T>::value) {
            CV_Assert(val::global("Array").call<bool>("isArray", value));
            for (unsigned i = 0; i < value["length"].as<unsigned>(); ++i) validate<typename Vector<T>::Element>(value[i]);
        } else if constexpr (std::is_same_v<T, cv::Mat> || std::is_same_v<T, cv::gapi::wip::draw::Prim>) {
            constexpr auto name = std::is_same_v<T, cv::Mat> ? "Mat" : "GDrawPrim";
            CV_Assert(value.instanceof(val::module_property(name)) && !value.call<bool>("isDeleted"));
        } else if constexpr (std::is_same_v<T, bool>) CV_Assert(value.typeOf().as<std::string>() == "boolean");
        else if constexpr (std::is_same_v<T, std::string>) CV_Assert(value.typeOf().as<std::string>() == "string");
        else if constexpr (std::is_same_v<T, int64_t> || std::is_same_v<T, uint64_t>) {
            CV_Assert(value.typeOf().as<std::string>() == "bigint");
            constexpr auto cast = std::is_signed_v<T> ? "asIntN" : "asUintN";
            CV_Assert(value.strictlyEquals(val::global("BigInt").call<val>(cast, 64, value)));
        } else if constexpr (std::is_arithmetic_v<T>) {
            CV_Assert(value.typeOf().as<std::string>() == "number");
            if constexpr (std::is_integral_v<T>) {
                const double n = value.as<double>();
                CV_Assert(std::isfinite(n) && std::trunc(n) == n && n >= std::numeric_limits<T>::lowest() && n <= std::numeric_limits<T>::max());
            }
        } else if constexpr (std::is_same_v<T, cv::Scalar>) {
            CV_Assert(val::global("Array").call<bool>("isArray", value) && value["length"].as<unsigned>() == 4);
            for (unsigned i = 0; i < 4; ++i) validate<double>(value[i]);
        } else {
            CV_Assert(!value.isNull() && value.typeOf().as<std::string>() == "object");
            if constexpr (std::is_same_v<T, cv::Point> || std::is_same_v<T, cv::Rect>) {
                validate<int>(value["x"]); validate<int>(value["y"]);
            } else if constexpr (std::is_same_v<T, cv::Point2f> || std::is_same_v<T, cv::Point3f>) {
                validate<float>(value["x"]); validate<float>(value["y"]);
                if constexpr (std::is_same_v<T, cv::Point3f>) validate<float>(value["z"]);
            }
            if constexpr (std::is_same_v<T, cv::Size> || std::is_same_v<T, cv::Rect>) {
                validate<int>(value["width"]); validate<int>(value["height"]);
            }
        }
    }

    template<class T> T read(const val& value) {
        validate<T>(value);
        if constexpr (Vector<T>::value) return emscripten::vecFromJSArray<typename Vector<T>::Element>(value);
        else return value.as<T>();
    }

    template<class T> val pack(const T& value, BorrowedHandles& borrowed) {
        if constexpr (Vector<T>::value) {
            auto array = val::array();
            for (unsigned i = 0; i < value.size(); ++i) array.set(i, pack(typename Vector<T>::Element(value[i]), borrowed));
            return array;
        } else if constexpr (std::is_same_v<T, cv::Mat> || std::is_same_v<T, cv::gapi::wip::draw::Prim>) return borrowed.add(value);
        else return val(value);
    }

    struct Port {
        cv::GShape shape;
        cv::detail::OpaqueKind kind;
        cv::detail::HostCtor constructor;
        std::function<cv::GArg(const val&)> argument;
        std::function<val(cv::GCall&, unsigned)> yield;
        std::function<val(cv::GCPUContext&, unsigned, BorrowedHandles&)> input, output;
        std::function<void(const val&)> validate;
        std::function<void(cv::GCPUContext&, unsigned, const val&)> store;
    };

    template<class G> Port port(const std::string& name) {
        constexpr auto shape = cv::detail::GTypeTraits<G>::shape;
        using T = std::decay_t<decltype(cv::detail::get_in<G>::get(std::declval<cv::GCPUContext&>(), 0))>;
        return {shape, cv::detail::GTypeTraits<G>::op_kind, cv::detail::GObtainCtor<G>::get(),
            [name](const val& value) {
                CV_Assert(value.instanceof(val::module_property(name.c_str())) && !value.call<bool>("isDeleted"));
                return cv::GArg(value.as<G>());
            },
            [](cv::GCall& call, unsigned index) { return val(cv::detail::Yield<G>::yield(call, index)); },
            [](cv::GCPUContext& context, unsigned index, BorrowedHandles& borrowed) {
                return pack<T>(cv::detail::get_in<G>::get(context, index), borrowed);
            },
            [](cv::GCPUContext& context, unsigned index, BorrowedHandles& borrowed) {
                if constexpr (shape == cv::GShape::GMAT) return pack(context.outMatR(index), borrowed);
                else return pack(T{}, borrowed);
            },
            [](const val& value) { validate<T>(value); },
            [](cv::GCPUContext& context, unsigned index, const val& value) {
                auto result = read<T>(value);
                if constexpr (shape == cv::GShape::GMAT) {
                    auto& output = context.outMatR(index);
                    CV_Assert(result.type() == output.type() && result.size == output.size);
                    if (result.data != output.data) result.copyTo(output);
                } else if constexpr (shape == cv::GShape::GSCALAR) context.outValR(index) = result;
                else if constexpr (shape == cv::GShape::GARRAY) context.outVecR<typename Vector<T>::Element>(index) = std::move(result);
                else context.outOpaqueR<T>(index) = std::move(result);
            }};
    }

    Port resolve(const std::string& name) {
        if (name == "mat") return port<cv::GMat>("GMat");
        if (name == "scalar") return port<cv::GScalar>("GScalar");
        @TYPED_GRAPH_PORTS@
        CV_Error(cv::Error::StsBadArg, "Unsupported graph port: " + name);
    }

    std::vector<Port> ports(const val& values) {
        CV_Assert(val::global("Array").call<bool>("isArray", values));
        std::vector<Port> result;
        for (unsigned i = 0; i < values["length"].as<unsigned>(); ++i) result.push_back(resolve(values[i].as<std::string>()));
        CV_Assert(!result.empty());
        return result;
    }

    class Operation {
        std::string id;
        std::vector<Port> inputs, outputs;
        cv::GKernel::M metadata;
    public:
        Operation(const std::string& name, const val& in, const val& out, const val& outMeta)
            : id(name), inputs(ports(in)), outputs(ports(out)) {
            CV_Assert(!id.empty());
            CV_Assert(outMeta.isUndefined() || outMeta.typeOf().as<std::string>() == "function");
            for (const auto& port : outputs) if (port.shape == cv::GShape::GMAT) CV_Assert(!outMeta.isUndefined());
            metadata = [inPorts = inputs, outPorts = outputs, outMeta](const cv::GMetaArgs& meta, const cv::GArgs&) {
                CV_Assert(meta.size() == inPorts.size());
                auto descriptions = val::array();
                if (!outMeta.isUndefined()) {
                    auto args = val::array(), layouts = val::array();
                    for (unsigned i = 0; i < meta.size(); ++i)
                        layouts.set(i, inPorts[i].shape == cv::GShape::GMAT ? GraphKernels::describe(cv::util::get<cv::GMatDesc>(meta[i])) : val::null());
                    args.set(0, layouts);
                    descriptions = CallbackBridge::call(outMeta, val::undefined(), args);
                    CV_Assert(val::global("Array").call<bool>("isArray", descriptions) && descriptions["length"].as<unsigned>() == outPorts.size());
                }
                cv::GMetaArgs result;
                for (unsigned i = 0; i < outPorts.size(); ++i) {
                    if (outPorts[i].shape == cv::GShape::GMAT) result.emplace_back(GraphKernels::descriptor(descriptions[i]));
                    else {
                        if (!outMeta.isUndefined()) CV_Assert(descriptions[i].isNull());
                        if (outPorts[i].shape == cv::GShape::GSCALAR) result.emplace_back(cv::GScalarDesc{});
                        else if (outPorts[i].shape == cv::GShape::GARRAY) result.emplace_back(cv::GArrayDesc{});
                        else result.emplace_back(cv::GOpaqueDesc{});
                    }
                }
                return result;
            };
        }

        val on(const val& nodes) const {
            CV_Assert(val::global("Array").call<bool>("isArray", nodes) && nodes["length"].as<unsigned>() == inputs.size());
            cv::GKernel kernel{id, {}, metadata, {}, {}, {}, {}};
            cv::GArgs args;
            for (unsigned i = 0; i < inputs.size(); ++i) {
                args.push_back(inputs[i].argument(nodes[i]));
                kernel.inKinds.push_back(inputs[i].kind);
            }
            for (const auto& port : outputs) {
                kernel.outShapes.push_back(port.shape);
                kernel.outKinds.push_back(port.kind);
                kernel.outCtors.push_back(port.constructor);
            }
            cv::GCall call(kernel);
            call.setArgs(std::move(args));
            auto result = val::array();
            for (unsigned i = 0; i < outputs.size(); ++i) result.set(i, outputs[i].yield(call, i));
            return result;
        }

        cv::GKernelPackage kernel(const val& run) const {
            CV_Assert(run.typeOf().as<std::string>() == "function");
            cv::GCPUKernel implementation([inPorts = inputs, outPorts = outputs, run](cv::GCPUContext& context) {
                BorrowedHandles borrowed;
                auto args = val::array(), inputValues = val::array(), outputValues = val::array();
                for (unsigned i = 0; i < inPorts.size(); ++i) inputValues.set(i, inPorts[i].input(context, i, borrowed));
                for (unsigned i = 0; i < outPorts.size(); ++i) outputValues.set(i, outPorts[i].output(context, i, borrowed));
                args.set(0, inputValues); args.set(1, outputValues);
                CV_Assert(CallbackBridge::call(run, val::undefined(), args).isUndefined());
                CV_Assert(outputValues["length"].as<unsigned>() == outPorts.size());
                // Validate every value before changing native scalar and vector outputs.
                for (unsigned i = 0; i < outPorts.size(); ++i) outPorts[i].validate(outputValues[i]);
                for (unsigned i = 0; i < outPorts.size(); ++i) outPorts[i].store(context, i, outputValues[i]);
            });
            cv::GKernelPackage result;
            result.include(GraphKernels::Functor(id, cv::GKernelImpl{implementation, metadata}));
            return result;
        }
    };
}

EMSCRIPTEN_BINDINGS(typed_graph_callbacks) {
    emscripten::class_<TypedGraph::Operation>("GTypedOperation")
        .constructor<const std::string&, const emscripten::val&, const emscripten::val&, const emscripten::val&>()
        .function("on", &TypedGraph::Operation::on)
        .function("kernel", &TypedGraph::Operation::kernel);
}
