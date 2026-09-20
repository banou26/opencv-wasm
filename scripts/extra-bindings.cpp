namespace Extra {
    struct EMDResult { float value; float lowerBound; };
    EMDResult emd(cv::Mat& a, cv::Mat& b, int type, cv::Mat cost = cv::Mat(), float bound = 0, cv::Mat* flow = nullptr) {
        auto value = cv::EMD(a, b, type, cost, &bound, flow ? cv::_OutputArray(*flow) : cv::_OutputArray());
        return {value, bound};
    }
}

EMSCRIPTEN_BINDINGS(extra_portable_types) {
    class_<cv::MatShape>("MatShape")
        .constructor<>()
        .constructor<const std::vector<int>&>()
        .property("dims", +[](const cv::MatShape& shape) { return shape.dims; })
        .property("layout", +[](const cv::MatShape& shape) { return int(shape.layout); })
        .property("C", +[](const cv::MatShape& shape) { return shape.C; })
        .function("size", &cv::MatShape::size)
        .function("total", &cv::MatShape::total)
        .function("vec", &cv::MatShape::vec)
        .function("str", &cv::MatShape::str)
        .function("empty", &cv::MatShape::empty)
        .function("isScalar", &cv::MatShape::isScalar)
        .function("clear", &cv::MatShape::clear)
        .function("channels", &cv::MatShape::channels)
        .function("hasSymbols", &cv::MatShape::hasSymbols)
        .function("expand", &cv::MatShape::expand)
        .function("erase", +[](cv::MatShape& shape, int index) {
            CV_Assert(index >= 0 && index < shape.dims);
            shape.erase(shape.begin() + index);
        })
        .function("toLayout", +[](const cv::MatShape& shape, int layout) { return shape.toLayout(static_cast<cv::DataLayout>(layout)); })
        .function("toLayout", +[](const cv::MatShape& shape, int layout, int channels) { return shape.toLayout(static_cast<cv::DataLayout>(layout), channels); })
        .class_function("scalar", &cv::MatShape::scalar);
    value_object<Extra::EMDResult>("EMDResult").field("value", &Extra::EMDResult::value).field("lowerBound", &Extra::EMDResult::lowerBound);
    function("EMD", +[](cv::Mat& a, cv::Mat& b, int type) { return Extra::emd(a, b, type); });
    function("EMD", +[](cv::Mat& a, cv::Mat& b, int type, cv::Mat& cost) { return Extra::emd(a, b, type, cost); });
    function("EMD", +[](cv::Mat& a, cv::Mat& b, int type, cv::Mat& cost, float bound) { return Extra::emd(a, b, type, cost, bound); });
    function("EMD", +[](cv::Mat& a, cv::Mat& b, int type, cv::Mat& cost, float bound, cv::Mat& flow) { return Extra::emd(a, b, type, cost, bound, &flow); });
    enum_<cvflann::flann_distance_t>("flann_DistanceType")
        .value("L2", cvflann::FLANN_DIST_L2)
        .value("L1", cvflann::FLANN_DIST_L1)
        .value("MINKOWSKI", cvflann::FLANN_DIST_MINKOWSKI)
        .value("MAX", cvflann::FLANN_DIST_MAX)
        .value("HIST_INTERSECT", cvflann::FLANN_DIST_HIST_INTERSECT)
        .value("HELLINGER", cvflann::FLANN_DIST_HELLINGER)
        .value("CHI_SQUARE", cvflann::FLANN_DIST_CHI_SQUARE)
        .value("KULLBACK_LEIBLER", cvflann::FLANN_DIST_KULLBACK_LEIBLER)
        .value("DNAMMING", cvflann::FLANN_DIST_DNAMMING)
        .value("HAMMING", cvflann::FLANN_DIST_HAMMING);
    class_<cv::UMat>("UMat")
        .constructor<>()
        .constructor<int, int, int>()
        .property("rows", &cv::UMat::rows)
        .property("cols", &cv::UMat::cols)
        .function("getMat", +[](cv::UMat& m, int access) { return m.getMat(static_cast<cv::AccessFlag>(access)); })
        .function("get", +[](cv::UMat& m) { return m.getMat(cv::ACCESS_READ); })
        .function("isContinuous", &cv::UMat::isContinuous)
        .function("isSubmatrix", &cv::UMat::isSubmatrix)
        .function("channels", &cv::UMat::channels)
        .function("depth", &cv::UMat::depth)
        .function("total", &cv::UMat::total)
        .property("offset", &cv::UMat::offset)
        .function("clone", +[](const cv::UMat& m) { return m.clone(); })
        .function("empty", &cv::UMat::empty)
        .function("type", &cv::UMat::type)
        .function("copyTo", +[](const cv::UMat& src, cv::Mat& dst) { src.copyTo(dst); });
    class_<cv::flann::IndexParams>("flann_IndexParams")
        .constructor<>()
        .smart_ptr<cv::Ptr<cv::flann::IndexParams>>("Ptr_flann_IndexParams")
        .function("setInt", &cv::flann::IndexParams::setInt)
        .function("setFloat", &cv::flann::IndexParams::setFloat)
        .function("setDouble", &cv::flann::IndexParams::setDouble)
        .function("setString", &cv::flann::IndexParams::setString)
        .function("setBool", &cv::flann::IndexParams::setBool)
        .function("setAlgorithm", &cv::flann::IndexParams::setAlgorithm);
    class_<cv::flann::SearchParams, base<cv::flann::IndexParams>>("flann_SearchParams")
        .constructor<>().constructor<int>().constructor<int, float>().constructor<int, float, bool>()
        .smart_ptr<cv::Ptr<cv::flann::SearchParams>>("Ptr_flann_SearchParams");
    class_<cv::flann::KDTreeIndexParams, base<cv::flann::IndexParams>>("flann_KDTreeIndexParams")
        .constructor<>().constructor<int>()
        .smart_ptr<cv::Ptr<cv::flann::KDTreeIndexParams>>("Ptr_flann_KDTreeIndexParams");
    class_<cv::flann::LinearIndexParams, base<cv::flann::IndexParams>>("flann_LinearIndexParams")
        .constructor<>().smart_ptr<cv::Ptr<cv::flann::LinearIndexParams>>("Ptr_flann_LinearIndexParams");
    class_<cv::flann::LshIndexParams, base<cv::flann::IndexParams>>("flann_LshIndexParams")
        .constructor<int, int, int>().smart_ptr<cv::Ptr<cv::flann::LshIndexParams>>("Ptr_flann_LshIndexParams");
    value_object<std::pair<int, double>>("IntDoublePair")
        .field("first", &std::pair<int, double>::first).field("second", &std::pair<int, double>::second);
    class_<cv::dnn::LayerParams>("dnn_LayerParams")
        .constructor<>()
        .property("name", &cv::dnn::LayerParams::name)
        .property("type", &cv::dnn::LayerParams::type)
        .property("blobs", &cv::dnn::LayerParams::blobs)
        .function("setInt", +[](cv::dnn::LayerParams& p, const std::string& key, int value) { p.set(key, value); })
        .function("setReal", +[](cv::dnn::LayerParams& p, const std::string& key, double value) { p.set(key, value); })
        .function("setString", +[](cv::dnn::LayerParams& p, const std::string& key, const std::string& value) { p.set(key, value); });
    function("randShuffle", +[](cv::Mat& m) { cv::randShuffle(m); });
    function("randShuffle", +[](cv::Mat& m, double factor) { cv::randShuffle(m, factor); });
    function("toUMat", +[](const cv::Mat& m, int access) { return m.getUMat(static_cast<cv::AccessFlag>(access)); });
    function("KeyPoint_overlap", &cv::KeyPoint::overlap);
    function("KeyPoint_convert", +[](const std::vector<cv::KeyPoint>& points) { std::vector<cv::Point2f> result; cv::KeyPoint::convert(points, result); return result; });
    function("KeyPoint_convert1", +[](const std::vector<cv::Point2f>& points, float size, float response, int octave, int class_id) { std::vector<cv::KeyPoint> result; cv::KeyPoint::convert(points, result, size, response, octave, class_id); return result; });
    function("matWithShape", +[](const std::vector<int>& shape, int type) { return cv::Mat(shape, type); });
    function("reshapeWithShape", +[](const cv::Mat& m, int channels, const std::vector<int>& shape) { return m.reshape(channels, shape); });
}
