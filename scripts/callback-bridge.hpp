#include <emscripten.h>

using emscripten::EM_VAL;
// Catch JS errors before re-entering C++ so native cleanup also runs on callback failure.
EM_JS(EM_VAL, opencv_callback_call, (EM_VAL fn, EM_VAL receiver, EM_VAL args), {
    try { return Emval.toHandle({value: Reflect.apply(Emval.toValue(fn), Emval.toValue(receiver), Emval.toValue(args))}); }
    catch (error) { return Emval.toHandle({error: String(error)}); }
});

namespace CallbackBridge {
    using emscripten::val;

    val call(const val& function, const val& receiver, const val& args) {
        auto result = val::take_ownership(opencv_callback_call(function.as_handle(), receiver.as_handle(), args.as_handle()));
        if (result.hasOwnProperty("error")) CV_Error(cv::Error::StsError, result["error"].as<std::string>());
        return result["value"];
    }

    // Embind copies Mat headers into JS handles; callbacks borrow them only until return.
    struct BorrowedMats {
        val values = val::array();
        std::vector<val> handles;
        explicit BorrowedMats(const std::vector<cv::Mat>& matrices) {
            for (unsigned i = 0; i < matrices.size(); ++i) {
                val handle(matrices[i]);
                handles.push_back(handle);
                values.set(i, handle);
            }
        }
        ~BorrowedMats() {
            for (const auto& matrix : handles) {
                if (!matrix.call<bool>("isDeleted")) matrix.call<void>("delete");
            }
        }
    };

}
