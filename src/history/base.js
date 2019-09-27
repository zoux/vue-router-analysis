/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError, isExtendedError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import { NavigationDuplicated } from './errors'

export class History {
  router: Router
  base: string
  current: Route
  pending: ?Route
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>

  // implemented by sub-classes
  +go: (n: number) => void
  +push: (loc: RawLocation) => void
  +replace: (loc: RawLocation) => void
  +ensureURL: (push?: boolean) => void
  +getCurrentLocation: () => string

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
  }

  listen (cb: Function) {
    this.cb = cb
  }

  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  // transitionTo 主要的流程：
  // 1. 执行transitionTo函数，先得到需要跳转路由的 match 对象route
  // 2. 执行confirmTransition函数
  // 3. confirmTransition函数内部判断是否是需要跳转，如果不需要跳转，则直接中断返回
  // 4. confirmTransition判断如果是需要跳转，则先得到钩子函数的任务队列 queue
  // 5. 通过 runQueue 函数来批次执行任务队列中的每个方法。
  // 6. 在执 queue 的钩子函数的时候，通过iterator来构造迭代器由用户传入 next方法，确定执行的过程
  // 7. 一直到整个队列执行完毕后，开始处理完成后的回调函数。
  transitionTo (
    location: RawLocation,
    onComplete?: Function,
    onAbort?: Function
  ) {
    // 通过目标路径 location 匹配定义的 route 数据，根据匹配到的记录，来进行 _createRoute 操作，最后返回 Route 对象
    // 简而言之即是：匹配目标 url 的 route 对象
    const route = this.router.match(location, this.current)
    this.confirmTransition( // 调用 this.confirmTransition 执行路由转换
      route,
      () => { // 跳转完成的钩子
        this.updateRoute(route) // 更新 route
        onComplete && onComplete(route) // 执行 onComplete
        this.ensureURL() // 更新浏览器 url

        // 调用 ready 的回调
        if (!this.ready) {
          this.ready = true
          this.readyCbs.forEach(cb => {
            cb(route)
          })
        }
      },
      err => { // 处理异常的钩子
        if (onAbort) {
          onAbort(err)
        }
        if (err && !this.ready) {
          this.ready = true
          this.readyErrorCbs.forEach(cb => {
            cb(err)
          })
        }
      }
    )
  }

  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    const abort = err => { // 定义中断处理
      // after merging https://github.com/vuejs/vue-router/pull/2771 we
      // When the user navigates through history through back/forward buttons
      // we do not want to throw the error. We only throw it if directly calling
      // push/replace. That's why it's not included in isError
      if (!isExtendedError(NavigationDuplicated, err) && isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => {
            cb(err)
          })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    if ( // 同路由且 matched.length 相同
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      route.matched.length === current.matched.length
    ) {
      this.ensureURL()
      return abort(new NavigationDuplicated(route))
    }

    // 交叉比对当前路由的路由记录和现在的这个路由的路由记录来确定出哪些组件需要更新，哪些需要激活，哪些组件被卸载。
    // 再执行其中的对应钩子函数
    const { updated, deactivated, activated } = resolveQueue(
      this.current.matched,
      route.matched
    )

    const queue: Array<?NavigationGuard> = [].concat( // 整个切换周期的钩子函数队列
      extractLeaveGuards(deactivated), // 找到即将被销毁的路由组件的 beforeRouteLeave
      this.router.beforeHooks, // 全局 router beforeEach
      extractUpdateHooks(updated), // 得到重用组件的 beforeRouteUpdate
      activated.map(m => m.beforeEnter), // 将要更新的路由的 beforeEnter
      // 处理异步组件
      // 通过判断路由上定义的组件是函数且没有 options 来确定异步组件，然后在得到真正的异步组件之前将其路由挂起
      resolveAsyncComponents(activated)
    )

    this.pending = route

    const iterator = (hook: NavigationGuard, next) => { // 每一个队列执行的 iterator 函数
      // 如果当前处理的路由，已经不等于 route 则终止处理
      if (this.pending !== route) {
        return abort()
      }
      try {
        hook(route, current, (to: any) => { // hook 是 queue 中的钩子函数，在这里执行
          // 钩子函数外部执行的 next 方法
          // next(false): 中断当前的导航。
          // 如果浏览器的 URL 改变了 (可能是用户手动或者浏览器后退按钮)
          // 那么 URL 地址会重置到 from 路由对应的地址。
          if (to === false || isError(to)) {
            // next(false) -> abort navigation, ensure current URL
            this.ensureURL(true)
            abort(to)
          } else if (
            typeof to === 'string' ||
            (typeof to === 'object' &&
              (typeof to.path === 'string' || typeof to.name === 'string'))
          ) {
            // next('/') or next({ path: '/' }): 跳转到一个不同的地址。
            // 当前的导航被中断，然后进行一个新的导航。
            abort()
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } else {
            // 当前钩子执行完成，移交给下一个钩子函数
            // 注意这里的 next 指的是 runQueue 中传过的执行队列下一个方法函数: step(index + 1)
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    // 先执行 queue 中的相关钩子
    // 处理完 queue 之后，将要执行的回调主要就是接入路由组件后期的钩子函数beforeRouteEnter和beforeResolve，并进行队列执行
    // 一切处理完成后，开始执行transitionTo的回调函数onComplete
    runQueue(queue, iterator, () => {
      const postEnterCbs = []
      const isValid = () => this.current === route
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid) // 获取 beforeRouteEnter 钩子函数
      const queue = enterGuards.concat(this.router.resolveHooks) // 获取 beforeResolve 钩子函数 并合并生成另一个 queue
      runQueue(queue, iterator, () => {
        // 处理完，就不需要再次执行
        if (this.pending !== route) {
          return abort()
        }
        this.pending = null // 清空
        onComplete(route) // 调用 onComplete 函数
        if (this.router.app) {
          // nextTick 执行 postEnterCbs 所有回调
          this.router.app.$nextTick(() => {
            postEnterCbs.forEach(cb => {
              cb()
            })
          })
        }
      })
    })
  }

  updateRoute (route: Route) {
    const prev = this.current
    this.current = route // 当前路由更新
    this.cb && this.cb(route) // cb 执行
    // 调用 afterEach 钩子
    this.router.afterHooks.forEach(hook => {
      hook && hook(route, prev)
    })
  }
}

function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}

function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length) // 取得最大深度
  for (i = 0; i < max; i++) {
    // 如果记录不一样则停止
    if (current[i] !== next[i]) {
      break
    }
  }
  // 分别返回哪些需要更新，哪些需要激活，哪些需要卸载
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}

function extractGuards (
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name) // 获取组件的 beforeRouteLeave 钩子函数
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}

function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}

function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}

function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}

function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    (guard, _, match, key) => {
      return bindEnterGuard(guard, match, key, cbs, isValid)
    }
  )
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          poll(cb, match.instances, key, isValid)
        })
      }
      next(cb)
    })
  }
}

function poll (
  cb: any, // somehow flow cannot infer this is a function
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance
  ) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
