import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/** A deterministic translating texture with H.264 B-frames and multiple GOPs. */
export async function makeFixture(directory) {
  await mkdir(directory, { recursive: true })
  const width = 192, height = 128, count = 32, bytes = Buffer.alloc(width * height * 3 * count)
  const texture = Buffer.alloc(width * height * 3)
  let random = 412947
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const at = (y * width + x) * 3, noise = random >>> 26
    texture[at] = 35 + (x * 3 + y * 5 + noise) % 185
    texture[at + 1] = 25 + (x * 5 + y * 2 + noise) % 185
    texture[at + 2] = 45 + (x * 2 + y * 7 + noise) % 185
  }
  for (let n = 0; n < count; n++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (((y - n + height) % height) * width + (x - n * 2 + width) % width) * 3
    texture.copy(bytes, (n * width * height + y * width + x) * 3, from, from + 3)
  }
  const raw = resolve(directory, 'fixture.rgb'), video = resolve(directory, 'fixture.mp4'), reference = resolve(directory, 'reference.rgb')
  await writeFile(raw, bytes)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', '24', '-i', raw, '-vf', 'scale=out_color_matrix=bt709', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '12', '-bf', '3', '-x264-params', 'open-gop=1:keyint=12:min-keyint=12:scenecut=0', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', video])
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-pix_fmt', 'rgb24', '-f', 'rawvideo', reference])
  return { width, height, count, video, reference }
}
