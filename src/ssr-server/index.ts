import express, { Express, RequestHandler } from 'express'
import serve from 'serve-static'
import { ViteDevServer, createServer as createViteServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'
import path from 'node:path'
import fs from 'node:fs'

const isProd = process.env.NODE_ENV === 'production'
const cwd = process.cwd()

function matchPageUrl(url: string) {
  if (url === '/') {
    return true
  }
  return false
}

async function createSsrMiddleware(app: Express): Promise<RequestHandler> {
  let vite: ViteDevServer | null = null
  if (!isProd) {
    // https://cn.vitejs.dev/config/server-options.html#server-middlewaremode
    vite = await createViteServer({
      root: cwd,
      server: {
        middlewareMode: true,
      },
      appType: 'custom' // 不引入 Vite 默认的 HTML 处理中间件
    })

    // 将 vite 的 connect 实例作中间件使用
    // 注册 Vite Middlewares
    // 主要用来处理客户端资源
    app.use(vite.middlewares)
  }

  return async (req, res, next) => {
    try {

      const url = req.originalUrl
      if (!matchPageUrl(url)) {
        // 走静态资源的处理
        return await next()
      }
      // SSR 的逻辑
      // 1. 加载服务端入口模块
      const { ServerEntry, fetchData } = await loadSsrEntryModule(vite)
      // 2. 数据预取
      const data = await fetchData()
      // 3. 「核心」渲染组件 - 组件渲染 -> 字符串
      const appHtml = renderToString(React.createElement(ServerEntry, { data }))
      // 4. 拼接 HTML，返回响应
      const templatePath = resolveTemplatePath()
      let template = await fs.readFileSync(templatePath, 'utf-8')
      // 开发模式下需要注入 HMR、环境变量相关的代码，因此需要调用 vite.transformIndexHtml
      if (!isProd && vite) {
        template = await vite.transformIndexHtml(url, template)
      }
      const html = template
        .replace('<!-- SSR_APP -->', appHtml)
          // 注入数据标签，用于客户端 hydrate
          .replace(
            '<!-- SSR_DATA -->',
            `<script>window.__SSR_DATA__=${JSON.stringify(data)}</script>`
          )
      res.status(200).setHeader('Content-Type', 'text/html').end(html);
    } catch (e: any) {
      vite?.ssrFixStacktrace(e)
      console.error(e)
      res.status(500).end(e.message)
    }
    
  }
}

// 1. 加载服务端入口模块
async function loadSsrEntryModule(vite: ViteDevServer | null) {
  if (isProd) {  // 生产模式下直接 require 打包后的产物
    const entryPath = path.join(cwd, 'dist/server/entry-server.js')
    return import(entryPath)
  } else { // 开发环境下通过 no-bundle 方式加载
    const entryPath = path.join(cwd, 'src/entry-server.tsx')
    return vite!.ssrLoadModule(entryPath)
  }
}

function resolveTemplatePath() {
  return isProd 
    ? path.join(cwd, 'dist/client/index.html')
    : path.join(cwd, 'index.html')
}



async function createServer() {
  const app = express()

  app.use(await createSsrMiddleware(app))

  if (isProd) {
    app.use(serve(path.join(cwd, 'dist/client')))
  }

  app.listen(3333, () => {
    console.log('Node服务器已启动')
    console.log(`http://localhost:3333`)
  })
}

createServer()
