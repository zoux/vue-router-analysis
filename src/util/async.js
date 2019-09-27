/* @flow */

export function runQueue (queue: Array<?NavigationGuard>, fn: Function, cb: Function) {
  const step = index => {
    // 如果全部执行完成则执行回调函数 cb
    if (index >= queue.length) {
      cb()
    } else {
      // 如果存在对应的函数
      if (queue[index]) {
        // 这里的 fn 传过来的是个 iterator 函数
        fn(queue[index], () => {
          // 执行队列中的下一个元素
          step(index + 1)
        })
      } else {
        // 执行队列中的下一个元素
        step(index + 1)
      }
    }
  }

  // 默认执行钩子队列中的第一个数据
  step(0)
}
