# Lab assets

- `relu.onnx`: the repository's tiny ONNX ReLU test fixture. It is an illustrative operator, not a trained recognition model.
- `trained_classifierNM1.xml` and `trained_classifierNM2.xml`: OpenCV contrib 5.0.0 text sample classifiers, copied from `modules/text/samples/` of the vendored source. They use the OpenCV license distributed at `/licenses/opencv_contrib-5.0.0/LICENSE`.

These files are loaded only by their corresponding experiments. User images and uploaded models remain in the browser.

- `eng.traineddata`: English LSTM language data from [tesseract-ocr/tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0), Apache-2.0. See `tessdata-LICENSE.txt`. SHA-256: `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.
- `FSRCNN_x2.pb`: trained FSRCNN model from [Saafke/FSRCNN_Tensorflow](https://github.com/Saafke/FSRCNN_Tensorflow/tree/6a4812c4ef1c4f5947d79beafa32a05a6eb4a94d), Apache-2.0. See `FSRCNN-LICENSE.txt`. SHA-256: `366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c`.

The documentation assets are separate from the npm package. The neural models run locally on CPU; no image or model request is sent to a third-party inference service.
