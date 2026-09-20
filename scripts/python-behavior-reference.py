"""Generate numeric fixtures using the pinned native Python wheel."""
import json
from pathlib import Path
import cv2 as cv
import numpy as np

results = {}
def record(name, value):
    results[name] = np.asarray(value).reshape(-1).tolist()

image = np.array([0, 16, 64, 128, 200, 255], np.uint8).reshape(2, 3)
gamma = np.empty_like(image)
cv.intensity_transform.gammaCorrection(image, gamma, 2)
record('gamma', gamma)
record('averageHash', cv.img_hash.averageHash(np.arange(256, dtype=np.uint8).reshape(16, 16)))
quality, quality_map = cv.quality.QualityMSE_compute(np.array([[1, 2, 3]], np.uint8), np.array([[2, 4, 6]], np.uint8))
record('quality', quality)
record('qualityMap', quality_map)
depth = np.arange(1, 7, dtype=np.float32).reshape(2, 3)
camera = np.array([[2, 0, 1], [0, 2, .5], [0, 0, 1]], np.float32)
record('depth3d', cv.depthTo3d(depth, camera))
wrapped = np.tile(((np.arange(8) * .8 + np.pi) % (2 * np.pi) - np.pi).astype(np.float32), (6, 1))
params = cv.phase_unwrapping.HistogramPhaseUnwrapping.Params()
params.width, params.height = 8, 6
record('unwrapped', cv.phase_unwrapping.HistogramPhaseUnwrapping_create(params).unwrapPhaseMap(wrapped))
pattern = cv.structured_light.GrayCodePattern_create(8, 4)
ok, images = pattern.generate()
assert ok
error, point = pattern.getProjPixel(images, 3, 2)
record('projectorPixel', [int(error), *point])
record('patternFirstRow', images[0][0])
record('inverseShift', cv.reg.MapTypeCaster_toShift(cv.reg.MapShift(np.array([.25, -.5], np.float64)).inverseMap()).getShift())
colour = np.array([(i * 37 + 11) % 256 for i in range(300)], np.uint8).reshape(10, 10, 3)
record('whiteBalance', cv.xphoto.createSimpleWB().balanceWhite(colour))
record('resampled', cv.signal.resampleSignal(np.array([[0, 1, 0, -1, 0, 1, 0, -1]], np.float32), 8000, 4000))
contour = np.array([[0, 0], [4, 0], [4, 4], [0, 4]], np.float32).reshape(-1, 1, 2)
record('hausdorff', cv.createHausdorffDistanceExtractor().computeDistance(contour, contour + np.array([2, 0], np.float32)))

network = cv.dnn.readNetFromONNX('tests/fixtures/arithmetic.onnx')
network.setInput(np.array([1, 2, 3, 4], np.float32).reshape(1, 1, 2, 2), 'left')
network.setInput(np.array([10, 20, 30, 40], np.float32).reshape(1, 1, 2, 2), 'right')
sum_result, difference_result = network.forward(['sum', 'difference'])
record('dnnSum', sum_result)
record('dnnDifference', difference_result)
network = cv.dnn.readNetFromONNX('tests/fixtures/relu.onnx')
colour = np.arange(10, 121, 10, dtype=np.uint8).reshape(2, 2, 3)
network.setInput(cv.dnn.blobFromImage(colour, .5, (2, 2), (1, 2, 3), swapRB=True))
record('dnnColour', network.forward())
image = np.array([-1, 0, 10, 20, 2, 3, 30, 40], np.float32).reshape(2, 4)
regions = []
for x in [0, 2]:
    network.setInput(cv.dnn.blobFromImage(image[:, x:x + 2], 2, (2, 2), (1, 0, 0)))
    regions.append(network.forward().copy())
record('dnnRegions', regions)
Path('tests/fixtures/python-behavior.json').write_text(json.dumps({'opencvVersion': cv.__version__, 'results': results}, indent=2) + '\n')
print('Captured Python results:', ', '.join(results))
