import type { Experiment } from './context'
/** Execute image filters, transforms, morphology and colour experiments. Returns false for another family. */
export const filters = (e: Experiment): boolean => {
  const { cv, gray, bgr, out } = e,
    id = e.request.algorithm,
    n = (key: string) => e.n(key),
    s = (key: string) => e.s(key)
  const tmp = e.mat(),
    size = () => ({ width: n('kernel'), height: n('kernel') })
  switch (id) {
    case 'gaussian-blur':
      cv.GaussianBlur(bgr, out, size(), n('sigma'))
      break
    case 'box-filter':
      cv.blur(bgr, out, size())
      break
    case 'median-filter':
      cv.medianBlur(bgr, out, n('kernel'))
      break
    case 'bilateral-filter':
      cv.bilateralFilter(bgr, out, n('diameter'), n('colour'), n('space'))
      break
    case 'filter2d': {
      const table = e.table('kernel')
      if (table.length !== table[0].length || table.length > 15 || table.length % 2 === 0)
        throw new Error('Use a square odd kernel, at most 15 × 15.')
      const kernel = e.array(table.length, table.length, cv.CV_32F, table.flat())
      cv.filter2D(gray, tmp, cv.CV_32F, kernel)
      e.raw(tmp, ['response'])
      cv.convertScaleAbs(tmp, out, n('gain'))
      break
    }
    case 'sobel':
    case 'scharr':
    case 'laplacian': {
      if (id === 'sobel')
        cv.Sobel(gray, tmp, cv.CV_32F, s('axis') === 'x' ? 1 : 0, s('axis') === 'y' ? 1 : 0, n('kernel'))
      else if (id === 'scharr') cv.Scharr(gray, tmp, cv.CV_32F, s('axis') === 'x' ? 1 : 0, s('axis') === 'y' ? 1 : 0)
      else cv.Laplacian(gray, tmp, cv.CV_32F, n('kernel'))
      e.raw(tmp, ['signed derivative'])
      cv.convertScaleAbs(tmp, out, n('gain'))
      break
    }
    case 'canny':
      if (n('high') < n('low')) throw new Error('High threshold must be at least the low threshold.')
      cv.Canny(gray, out, n('low'), n('high'), 3, s('norm') === 'L2')
      break
    case 'threshold': {
      const types: Record<string, number> = {
        binary: cv.THRESH_BINARY,
        inverse: cv.THRESH_BINARY_INV,
        otsu: cv.THRESH_BINARY | cv.THRESH_OTSU,
        truncate: cv.THRESH_TRUNC,
        'to-zero': cv.THRESH_TOZERO
      }
      const used = cv.threshold(gray, out, n('threshold'), 255, types[s('mode')])
      e.note = `Threshold used: ${used.toFixed(2)}.`
      break
    }
    case 'adaptive-threshold':
      cv.adaptiveThreshold(
        gray,
        out,
        255,
        s('method') === 'gaussian' ? cv.ADAPTIVE_THRESH_GAUSSIAN_C : cv.ADAPTIVE_THRESH_MEAN_C,
        cv.THRESH_BINARY,
        n('kernel'),
        n('offset')
      )
      break
    case 'erosion':
    case 'dilation':
    case 'morphology': {
      const element = e.own(cv.getStructuringElement(cv.MORPH_ELLIPSE, size())),
        mask = e.mask()
      if (id === 'erosion') cv.erode(mask, out, element, { x: -1, y: -1 }, n('iterations'))
      else if (id === 'dilation') cv.dilate(mask, out, element, { x: -1, y: -1 }, n('iterations'))
      else {
        const types: Record<string, number> = {
          open: cv.MORPH_OPEN,
          close: cv.MORPH_CLOSE,
          gradient: cv.MORPH_GRADIENT,
          'top-hat': cv.MORPH_TOPHAT,
          'black-hat': cv.MORPH_BLACKHAT
        }
        cv.morphologyEx(mask, out, types[s('operation')], element)
      }
      break
    }
    case 'distance-transform':
      cv.distanceTransform(
        e.mask(),
        tmp,
        s('metric') === 'L2' ? cv.DIST_L2 : s('metric') === 'L1' ? cv.DIST_L1 : cv.DIST_C,
        s('metric') === 'L2' ? cv.DIST_MASK_PRECISE : 3
      )
      e.field(tmp, ['distance (px)'])
      break
    case 'resize': {
      const methods: Record<string, number> = {
        nearest: cv.INTER_NEAREST,
        linear: cv.INTER_LINEAR,
        cubic: cv.INTER_CUBIC,
        area: cv.INTER_AREA,
        lanczos: cv.INTER_LANCZOS4
      }
      cv.resize(
        bgr,
        out,
        {
          width: Math.max(1, Math.round(gray.cols * n('scale'))),
          height: Math.max(1, Math.round(gray.rows * n('scale')))
        },
        0,
        0,
        methods[s('interpolation')]
      )
      break
    }
    case 'remap': {
      const xs = new Float32Array(gray.rows * gray.cols),
        ys = new Float32Array(xs.length)
      for (let y = 0; y < gray.rows; y++)
        for (let x = 0; x < gray.cols; x++) {
          xs[y * gray.cols + x] = x + n('amplitude') * Math.sin((y * 2 * Math.PI) / n('period'))
          ys[y * gray.cols + x] = y
        }
      cv.remap(
        bgr,
        out,
        e.array(gray.rows, gray.cols, cv.CV_32F, xs),
        e.array(gray.rows, gray.cols, cv.CV_32F, ys),
        cv.INTER_LINEAR,
        cv.BORDER_REFLECT_101
      )
      break
    }
    case 'affine-warp': {
      const matrix = e.own(cv.getRotationMatrix2D({ x: gray.cols / 2, y: gray.rows / 2 }, n('angle'), n('scale')))
      cv.warpAffine(bgr, out, matrix, e.size())
      break
    }
    case 'homography': {
      const w = gray.cols - 1,
        h = gray.rows - 1,
        inset = (w * n('inset')) / 100
      const from = e.array(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]),
        to = e.array(4, 1, cv.CV_32FC2, [inset, 0, w - inset, 0, w, h, 0, h]),
        matrix = e.own(cv.getPerspectiveTransform(from, to))
      cv.warpPerspective(
        bgr,
        out,
        matrix,
        e.size(),
        s('interpolation') === 'nearest'
          ? cv.INTER_NEAREST
          : s('interpolation') === 'cubic'
            ? cv.INTER_CUBIC
            : cv.INTER_LINEAR
      )
      break
    }
    case 'polar-warp':
      cv.warpPolar(
        bgr,
        out,
        e.size(),
        { x: gray.cols / 2, y: gray.rows / 2 },
        (Math.min(gray.cols, gray.rows) * n('radius')) / 100,
        cv.INTER_LINEAR | cv.WARP_FILL_OUTLIERS | (s('mode') === 'log' ? cv.WARP_POLAR_LOG : cv.WARP_POLAR_LINEAR)
      )
      break
    case 'image-pyramids': {
      let current = bgr
      for (let i = 0; i < n('level'); i++) {
        const next = e.mat()
        cv.pyrDown(current, next)
        current = next
      }
      if (s('view') === 'gaussian') current.copyTo(out)
      else {
        const down = e.mat(),
          up = e.mat(),
          a = e.mat(),
          b = e.mat(),
          residual = e.mat()
        cv.pyrDown(current, down)
        cv.pyrUp(down, up, { width: current.cols, height: current.rows })
        current.convertTo(a, cv.CV_32F)
        up.convertTo(b, cv.CV_32F)
        cv.subtract(a, b, residual)
        if (s('view') === 'laplacian') {
          e.raw(residual, ['B residual', 'G residual', 'R residual'])
          residual.convertTo(out, cv.CV_8U, 1, 128)
        } else {
          cv.add(residual, b, tmp)
          tmp.convertTo(out, cv.CV_8U)
        }
      }
      break
    }
    case 'histogram-equalization':
      cv.equalizeHist(gray, out)
      break
    case 'clahe':
      e.own(cv.createCLAHE(n('clip'), { width: n('tiles'), height: n('tiles') })).apply(gray, out)
      break
    case 'colour-conversion': {
      const spaces: Record<string, number> = {
        HSV: cv.COLOR_BGR2HSV,
        Lab: cv.COLOR_BGR2Lab,
        YCrCb: cv.COLOR_BGR2YCrCb,
        gray: cv.COLOR_BGR2GRAY
      }
      cv.cvtColor(bgr, tmp, spaces[s('space')])
      const channel = e.mat()
      cv.extractChannel(tmp, channel, Math.min(n('channel'), tmp.channels() - 1))
      e.field(channel, [`${s('space')} channel ${Math.min(n('channel'), tmp.channels() - 1)}`])
      break
    }
    case 'in-range': {
      if (n('hueMax') < n('hueMin')) throw new Error('Maximum hue must be at least minimum hue.')
      cv.cvtColor(bgr, tmp, cv.COLOR_BGR2HSV)
      const low = e.own(new cv.Mat(gray.rows, gray.cols, cv.CV_8UC3, [n('hueMin'), n('saturation'), 0, 0])),
        high = e.own(new cv.Mat(gray.rows, gray.cols, cv.CV_8UC3, [n('hueMax'), 255, 255, 0]))
      cv.inRange(tmp, low, high, out)
      break
    }
    case 'dft': {
      const input = e.mat(),
        spectrum = e.mat()
      gray.convertTo(input, cv.CV_32F)
      cv.dft(input, spectrum, cv.DFT_COMPLEX_OUTPUT)
      if (s('view') === 'reconstruction') {
        cv.idft(spectrum, tmp, cv.DFT_SCALE | cv.DFT_REAL_OUTPUT)
        tmp.convertTo(out, cv.CV_8U)
      } else {
        const real = e.mat(),
          imag = e.mat()
        cv.extractChannel(spectrum, real, 0)
        cv.extractChannel(spectrum, imag, 1)
        cv.magnitude(real, imag, tmp)
        const values = Float32Array.from(tmp.data32F, (x) => Math.log1p(x))
        const log = e.array(tmp.rows, tmp.cols, cv.CV_32F, values)
        cv.normalize(log, out, 0, 255, cv.NORM_MINMAX, cv.CV_8U)
        e.raw(spectrum, ['real', 'imaginary'])
      }
      break
    }
    case 'dct': {
      const padded = e.mat(),
        input = e.mat(),
        coeff = e.mat()
      cv.copyMakeBorder(gray, padded, 0, gray.rows % 2, 0, gray.cols % 2, cv.BORDER_REFLECT_101)
      padded.convertTo(input, cv.CV_32F)
      cv.dct(input, coeff)
      if (s('view') === 'reconstruction') {
        cv.idct(coeff, tmp)
        tmp.convertTo(out, cv.CV_8U)
      } else {
        const values = Float32Array.from(coeff.data32F, (x) => Math.log1p(Math.abs(x)))
        const log = e.array(coeff.rows, coeff.cols, cv.CV_32F, values)
        cv.normalize(log, out, 0, 255, cv.NORM_MINMAX, cv.CV_8U)
        e.raw(coeff, ['DCT coefficient'])
      }
      break
    }
    case 'nonlocal-means':
      cv.fastNlMeansDenoisingColored(bgr, out, n('strength'), n('strength'), 7, n('search'))
      break
    case 'inpainting': {
      const mask = e.own(cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U)),
        r = e.rect()
      cv.rectangle(mask, { x: r.x, y: r.y }, { x: r.x + r.width - 1, y: r.y + r.height - 1 }, [255, 0, 0, 0], -1)
      cv.inpaint(bgr, mask, out, n('radius'), s('method') === 'telea' ? cv.INPAINT_TELEA : cv.INPAINT_NS)
      break
    }
    case 'seamless-cloning': {
      const second = e.second(),
        mask = e.own(cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U)),
        r = e.rect()
      cv.rectangle(mask, { x: r.x, y: r.y }, { x: r.x + r.width - 1, y: r.y + r.height - 1 }, [255, 0, 0, 0], -1)
      cv.seamlessClone(
        second,
        bgr,
        mask,
        { x: Math.floor(gray.cols / 2), y: Math.floor(gray.rows / 2) },
        out,
        s('mode') === 'mixed' ? cv.MIXED_CLONE : cv.NORMAL_CLONE
      )
      break
    }
    case 'hdr': {
      const inputs = e.own(new cv.MatVector())
      inputs.push_back(bgr)
      inputs.push_back(e.second())
      const merger = e.own(cv.createMergeMertens(n('contrast'), n('saturation'), n('exposure')))
      merger.process1(inputs, tmp)
      e.raw(tmp, ['B linear', 'G linear', 'R linear'])
      tmp.convertTo(out, cv.CV_8U, 255)
      break
    }
    case 'guided-filter':
      cv.ximgproc.guidedFilter(bgr, bgr, out, n('radius'), n('epsilon'))
      break
    case 'thinning':
      cv.ximgproc.thinning(
        e.mask(),
        out,
        s('method') === 'guo-hall' ? cv.ximgproc.THINNING_GUOHALL : cv.ximgproc.THINNING_ZHANGSUEN
      )
      break
    case 'white-balance': {
      if (s('method') === 'simple') {
        const wb = e.own(cv.xphoto.createSimpleWB())
        wb.setP(n('percent'))
        wb.balanceWhite(bgr, out)
      } else e.own(cv.xphoto.createGrayworldWB()).balanceWhite(bgr, out)
      break
    }
    case 'saliency': {
      const sal = e.own(
        s('method') === 'spectral'
          ? cv.saliency.StaticSaliencySpectralResidual.create()
          : cv.saliency.StaticSaliencyFineGrained.create()
      )
      if (!sal.computeSaliency(bgr, tmp)) throw new Error('Saliency computation failed.')
      e.field(tmp, ['saliency'])
      break
    }
    case 'phase-unwrapping': {
      gray.convertTo(tmp, cv.CV_32F, (2 * Math.PI) / 255, -Math.PI)
      const params = e.own(new cv.phase_unwrapping.HistogramPhaseUnwrapping.Params())
      params.width = gray.cols
      params.height = gray.rows
      const unwrap = e.own(cv.phase_unwrapping.HistogramPhaseUnwrapping.create(params)),
        phase = e.mat()
      unwrap.unwrapPhaseMap(tmp, phase)
      e.field(phase, ['phase (radians)'])
      break
    }
    case 'structured-light': {
      const width = gray.cols,
        height = s('axis') === 'square' ? gray.cols : gray.rows,
        generator = e.own(cv.structured_light.GrayCodePattern.create(width, height)),
        patterns = e.own(new cv.MatVector())
      if (!generator.generate(patterns)) throw new Error('Pattern generation failed.')
      const index = Math.min(n('pattern'), patterns.size() - 1),
        pattern = e.own(patterns.get(index))
      pattern.copyTo(out)
      e.note = `Pattern ${index} of ${patterns.size()} (zero-based), projector ${width} × ${height}.`
      break
    }
    case 'retina': {
      const retina = e.own(cv.bioinspired.Retina.create(e.size()))
      if (s('pathway') === 'magno') {
        const dark = e.own(cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC3))
        retina.run(dark)
      }
      retina.run(bgr)
      if (s('pathway') === 'parvo') retina.getParvo(out)
      else retina.getMagno(out)
      break
    }
    default:
      return false
  }
  return true
}
