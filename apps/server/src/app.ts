/**
 * apps/server/src/app.ts
 *
 * Legacy 호환 — Phase 2-E 이후에는 이 파일을 직접 사용하지 않는다.
 * createApp() 은 더 이상 단일 앱을 반환하지 않으며,
 * 각 진입점(core-server, portal-server)이 자체 createCoreApp / createPortalApp 을 사용한다.
 *
 * 이 파일은 하위 호환 import 경로를 유지하기 위해 남겨 둔다.
 * 직접 사용은 deprecated.
 */

export { createCoreApp } from '@pvpentech/core/app';
export { createPortalApp } from '@pvpentech/portal/app';
