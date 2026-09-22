#!/usr/bin/env bash
set -euo pipefail
python3 scripts/patch-dependencies.py
prefix=/work/build/dependencies/install
mkdir -p "$prefix"
build_dependency() {
  local name="$1"
  shift
  local destination="/work/build/dependencies/$name"
  local config_key
  config_key=$({ printf '%s\n' "$@"; sha256sum /work/scripts/build-dependencies.sh /work/scripts/patch-dependencies.py /work/scripts/dependencies.json; } | sha256sum)
  if [[ -f "$destination/.installed" && "$(cat "$destination/.installed")" == "$config_key" ]]; then return; fi
  emcmake cmake -S "/work/vendor/dependencies/$name" -B "$destination" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_PREFIX_PATH="$prefix" \
    -DCMAKE_C_FLAGS='-O3 -msimd128 -fexceptions' -DCMAKE_CXX_FLAGS='-O3 -msimd128 -fexceptions' \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF "$@"
  cmake --build "$destination" --parallel "${BUILD_JOBS:-6}"
  cmake --install "$destination"
  printf '%s\n' "$config_key" > "$destination/.installed"
}
build_dependency freetype-2.13.3 -DFT_DISABLE_ZLIB=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON
build_dependency harfbuzz-10.2.0 -DHB_HAVE_FREETYPE=ON -DFREETYPE_LIBRARY="$prefix/lib/libfreetype.a" -DFREETYPE_INCLUDE_DIR_freetype2="$prefix/include/freetype2" -DFREETYPE_INCLUDE_DIR_ft2build="$prefix/include/freetype2" -DHB_HAVE_GLIB=OFF -DHB_HAVE_ICU=OFF -DHB_BUILD_UTILS=OFF -DHB_BUILD_SUBSET=OFF
build_dependency hdf5-1.14.5 -DHDF5_BUILD_TOOLS=OFF -DHDF5_BUILD_EXAMPLES=OFF -DHDF5_BUILD_HL_LIB=OFF -DHDF5_BUILD_CPP_LIB=OFF -DHDF5_BUILD_FORTRAN=OFF -DHDF5_ENABLE_Z_LIB_SUPPORT=OFF -DHDF5_ENABLE_SZIP_SUPPORT=OFF -DHDF5_ENABLE_ROS3_VFD=OFF -DHDF5_ENABLE_PARALLEL=OFF -DHDF5_ENABLE_THREADSAFE=OFF -DH5_HAVE_FENV_H=0 -DH5_HAVE_FECLEAREXCEPT=0
build_dependency leptonica-1.85.0 -DBUILD_PROG=OFF -DENABLE_ZLIB=OFF -DENABLE_PNG=OFF -DENABLE_GIF=OFF -DENABLE_JPEG=OFF -DENABLE_TIFF=OFF -DENABLE_WEBP=OFF -DENABLE_OPENJPEG=OFF
build_dependency tesseract-5.5.0 -ULeptonica_FOUND -DLeptonica_DIR="$prefix/lib/cmake/leptonica" -DOPENMP_BUILD=OFF -DGRAPHICS_DISABLED=ON -DBUILD_TRAINING_TOOLS=OFF -DBUILD_TESSERACT_BINARY=OFF -DDISABLE_TIFF=ON -DDISABLE_ARCHIVE=ON -DDISABLE_CURL=ON -DENABLE_NATIVE=OFF -DHAVE_AVX=OFF -DHAVE_AVX2=OFF -DHAVE_AVX512F=OFF -DHAVE_AVX512BW=OFF -DHAVE_FMA=OFF -DHAVE_SSE4_1=OFF -DHAVE_SSE4_2=OFF
# Dependencies are found through our explicit prefix. Registering gflags in the
# user's home directory fails for the host UID inside a fresh CI container.
build_dependency gflags-2.2.2 -DGFLAGS_BUILD_TESTING=OFF -DGFLAGS_BUILD_gflags_LIB=OFF -DGFLAGS_BUILD_gflags_nothreads_LIB=ON -DGFLAGS_REGISTER_INSTALL_PREFIX=OFF -DGFLAGS_REGISTER_BUILD_DIR=OFF
build_dependency glog-0.6.0 -Dgflags_DIR="$prefix/lib/cmake/gflags" -DWITH_GFLAGS=ON -DWITH_GTEST=OFF -DWITH_UNWIND=OFF -DWITH_SYMBOLIZE=OFF -DWITH_THREADS=OFF -DHAVE_SYMBOLIZE=OFF -DHAVE_SYSCALL_H=OFF -DHAVE_SYS_SYSCALL_H=OFF -DHAVE__UNWIND_BACKTRACE=OFF -DHAVE_UNWIND_H=OFF -DHAVE_STACKTRACE=OFF
build_dependency ceres-2.2.0 -Dgflags_DIR="$prefix/lib/cmake/gflags" -Dglog_DIR="$prefix/lib/cmake/glog" -DBUILD_EXAMPLES=OFF -DBUILD_BENCHMARKS=OFF -DSUITESPARSE=OFF -DLAPACK=OFF -DUSE_CUDA=OFF -DEigen3_DIR=/usr/share/eigen3/cmake -DSCHUR_SPECIALIZATIONS=OFF
build_dependency imath-3.1.12 -DPYTHON=OFF -DIMATH_INSTALL_PKG_CONFIG=ON
build_dependency libdeflate-1.23 -DLIBDEFLATE_BUILD_SHARED_LIB=OFF -DLIBDEFLATE_BUILD_STATIC_LIB=ON -DLIBDEFLATE_BUILD_GZIP=OFF -DLIBDEFLATE_BUILD_TESTS=OFF
build_dependency openexr-3.3.3 -DOPENEXR_ENABLE_THREADING=OFF -DOPENEXR_BUILD_TOOLS=OFF -DOPENEXR_INSTALL_TOOLS=OFF -DOPENEXR_BUILD_EXAMPLES=OFF -DOPENEXR_INSTALL_DOCS=OFF -DImath_DIR="$prefix/lib/cmake/Imath" -Dlibdeflate_DIR="$prefix/lib/cmake/libdeflate" -DFETCHCONTENT_FULLY_DISCONNECTED=ON
