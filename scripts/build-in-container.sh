#!/usr/bin/env bash
set -euo pipefail
prefix=/work/build/dependencies/install
bash scripts/build-dependencies.sh
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
python3 scripts/patch-opencv.py
emcmake cmake -S vendor/opencv-5.0.0 -B build/wasm5 \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_STANDARD=17 \
  -DCMAKE_C_FLAGS='-O3 -msimd128 -fexceptions' \
  -DCMAKE_CXX_FLAGS='-O3 -msimd128 -fexceptions' \
  -DCMAKE_EXE_LINKER_FLAGS='' \
  -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_FIND_ROOT_PATH="$prefix" \
  -DFREETYPE_FOUND=ON -DFREETYPE_INCLUDE_DIRS="$prefix/include/freetype2" -DFREETYPE_LIBRARIES="$prefix/lib/libfreetype.a" \
  -DHARFBUZZ_FOUND=ON -DHARFBUZZ_INCLUDE_DIRS="$prefix/include/harfbuzz" -DHARFBUZZ_LIBRARIES="$prefix/lib/libharfbuzz.a" \
  -DHDF5_FOUND=ON -DHDF5_INCLUDE_DIRS="$prefix/include" -DHDF5_LIBRARIES="$prefix/lib/libhdf5.a" \
  -Dgflags_DIR="$prefix/lib/cmake/gflags" -Dglog_DIR="$prefix/lib/cmake/glog" -DCeres_DIR="$prefix/lib/cmake/Ceres" -DEigen3_DIR=/usr/share/eigen3/cmake \
  -DGLOG_INCLUDE_DIR="$prefix/include" -DGFLAGS_INCLUDE_DIR="$prefix/include" \
  -DTesseract_FOUND=ON -DTesseract_VERSION=5.5.0 -DTesseract_INCLUDE_DIRS="$prefix/include" -DTesseract_LIBRARIES="$prefix/lib/libtesseract.a;$prefix/lib/libleptonica.a" \
  -DOPENCV_EXTRA_MODULES_PATH=/work/vendor/opencv_contrib-5.0.0/modules \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_opencv_js=ON -DOPENCV_ENABLE_NONFREE=ON \
  -DBUILD_LIST=core,imgproc,imgcodecs,geometry,calib,stereo,ptcloud,features,flann,dnn,ml,photo,video,objdetect,stitching,alphamat,bgsegm,bioinspired,ccalib,dnn_superres,dpm,face,fuzzy,hfs,img_hash,intensity_transform,line_descriptor,optflow,phase_unwrapping,plot,quality,rapid,reg,rgbd,saliency,shape,signal,xstereo,structured_light,surface_matching,text,tracking,wechat_qrcode,xfeatures2d,ximgproc,xobjdetect,xphoto,videoio,datasets,superres,videostab,dnn_objdetect,gapi,freetype,hdf,sfm,js \
  -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_opencv_apps=OFF \
  -DBUILD_opencv_python2=OFF -DBUILD_opencv_python3=OFF -DBUILD_opencv_java=OFF \
  -DBUILD_opencv_highgui=ON -DBUILD_opencv_videoio=ON \
  -DWITH_IPP=OFF -DWITH_ITT=OFF -DWITH_OPENCL=OFF -DWITH_CUDA=OFF \
  -DWITH_ONNXRUNTIME=OFF -DWITH_TBB=OFF -DWITH_PTHREADS_PF=OFF -DWITH_LAPACK=ON \
  -DWITH_FFMPEG=OFF -DWITH_GSTREAMER=OFF -DWITH_GTK=OFF -DWITH_QT=OFF \
  -DWITH_V4L=OFF -DWITH_1394=OFF -DWITH_OPENEXR=ON -DOpenEXR_DIR="$prefix/lib/cmake/OpenEXR" -DOPENCV_IO_FORCE_OPENEXR=ON -DWITH_AVIF=OFF \
  -DWITH_OPENJPEG=ON -DBUILD_OPENJPEG=ON -DWITH_JASPER=OFF -DWITH_PROTOBUF=ON -DBUILD_PROTOBUF=ON \
  -DWITH_JPEG=ON -DBUILD_JPEG=ON -DWITH_PNG=ON -DBUILD_PNG=ON \
  -DWITH_WEBP=ON -DBUILD_WEBP=ON -DWITH_TIFF=ON -DBUILD_TIFF=ON \
  -DWITH_QUIRC=ON -DWITH_EIGEN=ON -DEIGEN_INCLUDE_PATH=/usr/include/eigen3 -DWITH_ADE=ON -DWITH_VTK=OFF \
  -DWITH_TESSERACT=ON -DOPENCV_SKIP_TESSERACT_BUILD_CHECK=ON -DWITH_FREETYPE=ON -DWITH_HARFBUZZ=ON \
  -DCPU_BASELINE='' -DCPU_DISPATCH='' -DCV_TRACE=OFF
cmake --build build/wasm5 --target opencv_js --parallel "$BUILD_JOBS"
cp build/wasm5/bin/opencv_js.js lib/opencv.mjs
cp build/wasm5/bin/opencv_js.wasm lib/opencv_js.wasm
cp build/wasm5/bin/opencv.d.ts lib/opencv.d.ts
cp build/coverage.json lib/coverage.json
python3 scripts/copy-licenses.py
