# vue-router

## 核心阶段

#### install

1. 利用 Vue.mixin beforeCreate 注入 _routerRoot _router 到根实例，同时在根实例完成 router.init。
2. 代理 $router $route 到所有实例，注册全局组件 RouterView RouterLink。

#### init

1. 通过 history 来确定不同路由的切换动作动作 history.transitionTo。
2. 通过 history.listen 来注册路由变化的响应回调。

#### HashHistory 实例化

1. 针对因不支持 history api 而来实例化 HashHistory 的，进行降级处理。
2. 保证默认进入的时候对应的 hash 值是以 / 开头的，如果不是则替换。
