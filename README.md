# vue-router

## 核心要点

1. push, replace 方法会主动更新属性 _route。而 go / back / 浏览器前进后退，则会在 onhashchange / onpopstate 的回调中更新 _route。
2. 使用 Vue.util.defineReactive 将实例的 _route 设置为响应式后，_route 的更新会触发 RouterView 的重新渲染。


## 执行阶段

#### install

1. 利用 Vue.mixin beforeCreate 注入 _routerRoot _router 到根实例，同时在根实例完成 router.init。
2. 代理 $router $route 到所有实例，注册全局组件 RouterView RouterLink。

#### init

1. 通过 history 来确定不同路由的切换动作动作 history.transitionTo。
2. 通过 history.listen 来注册路由变化的响应回调。

#### HashHistory 实例化

1. 针对因不支持 history api 而来实例化 HashHistory 的，进行降级处理。
2. 保证默认进入的时候对应的 hash 值是以 / 开头的，如果不是则替换。


## 知识点

#### onhashchange

当URL的片段标识符更改时，将触发hashchange事件 (跟在＃符号后面的URL部分，包括＃符号)。
注意 histroy.pushState() 绝对不会触发 hashchange 事件，即使新的URL与旧的URL仅哈希不同也是如此。

#### onpopstate

调用history.pushState()或者history.replaceState()不会触发popstate事件。
popstate事件只会在浏览器某些行为下触发, 比如点击后退、前进按钮(或者在JavaScript中调用history.back()、history.forward()、history.go()方法)。

如果当前处于激活状态的历史记录条目是由history.pushState()方法创建, 或者由history.replaceState()方法修改过的, 
则popstate事件对象的state属性包含了这个历史记录条目的state对象的一个拷贝。

#### setupListeners

我们在通过点击后退, 前进按钮或者调用back, forward, go方法的时候。我们没有主动更新_app.route和current。
我们该如何触发RouterView的更新呢？通过在window上监听popstate，或者hashchange事件。在事件的回调中，调用transitionTo方法完成对_route和current的更新。

或者可以这样说，在使用push，replace方法的时候，hash的更新在_route更新的后面。而使用go, back时，hash的更新在_route更新的前面。
