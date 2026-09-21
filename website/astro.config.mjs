import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { algorithms } from './src/data/algorithms.ts'

export default defineConfig({
  integrations: [starlight({
    title: 'opencv-wasm',
    description: 'Computer vision in TypeScript. Learn the algorithms, inspect the API, and run OpenCV 5 in a browser or Node.js.',
    favicon: '/favicon.svg',
    social: [{ icon: 'github', label: 'Source repository', href: 'https://github.com/banou26/opencv-wasm' }],
    customCss: ['./src/styles/site.css'],
    sidebar: [
      { label: 'Start here', items: [{ label: 'Overview', link: '/' }, 'start/quickstart', 'start/node', 'start/matrices', 'start/python'] },
      { label: 'Algorithms', collapsed: true, items: [
        { label: 'All algorithms', link: '/algorithms/' },
        ...algorithms.map(({ id, title }) => ({ label: title, link: `/algorithms/${id}/` })),
      ] },
      { label: 'Learn by seeing', items: [{ label: 'Image laboratory', link: '/lab/' }, 'guides/choose', 'guides/detect-and-track'] },
      { label: 'Build with OpenCV', items: ['guides/workers', 'guides/dnn', 'guides/graphs', 'guides/files', 'guides/cadence'] },
      { label: 'Reference', items: [{ label: 'API browser', link: '/api/' }, { label: 'Modules and features', link: '/modules/' }, 'reference/compatibility', 'reference/troubleshooting', 'reference/build'] },
    ],
  })],
})
