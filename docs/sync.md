# 리포 간 동기화 가이드

## prisma/schema.prisma 동기화

`pvpentech-core`와 `pvpentech-portal` 두 리포는 **동일한 PostgreSQL 인스턴스**를 공유하며,
각 리포에 `prisma/schema.prisma`가 **동일하게** 존재합니다.

### 스키마 변경 시 절차

1. **한 쪽 리포에서 변경** (`pvpentech-core` 권장 — Core 모델이 더 자주 변경됨)
2. `npx prisma migrate dev --name <migration-name>` 실행
3. **변경된 파일 두 가지를 다른 리포에도 복사**:
   - `prisma/schema.prisma`
   - `prisma/migrations/<timestamp>_<name>/` 전체 디렉토리
4. 두 리포 모두 `npx prisma generate` 재실행
5. 두 리포 모두 커밋

### 운영 환경 마이그레이션 적용

마이그레이션은 수동으로 적용합니다 (자동 배포 없음):

```bash
# 한 번만 실행하면 됨 (같은 DB이므로 어느 리포에서든 가능)
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

> 두 리포 중 어느 쪽에서 실행해도 같은 DB에 적용됩니다.

## CSMS_INTERNAL_API_TOKEN 동기화

두 서비스가 동일한 토큰 값을 사용해야 합니다:

- `pvpentech-core` `.env`: `CSMS_INTERNAL_API_TOKEN=<value>`
- `pvpentech-portal` `.env`: `CSMS_INTERNAL_API_TOKEN=<value>` (Portal이 Core에 보내는 Bearer)

## packages/core 미러링

`pvpentech-portal` 리포의 `packages/core/src/`는 `pvpentech-core`의 일부 파일을 미러링합니다.
Portal 서버가 독립적으로 빌드되도록 Core 라우트/서비스/컨트롤러를 포함합니다.

Core에서 해당 파일들을 변경하면 Portal 리포에도 동기화해야 합니다:

```
pvpentech-core/packages/core/src/
  routes/portal/cs/*.routes.ts  → pvpentech-portal/packages/core/src/routes/portal/cs/
  routes/provision.routes.ts    → pvpentech-portal/packages/core/src/routes/
  services/*.service.ts         → pvpentech-portal/packages/core/src/services/
  controllers/*.controller.ts   → pvpentech-portal/packages/core/src/controllers/
  repositories/*.repository.ts  → pvpentech-portal/packages/core/src/repositories/
  validators/*.validator.ts     → pvpentech-portal/packages/core/src/validators/
```

> TODO(Phase 5): 공유 파일들을 npm 패키지(@pvpentech/core-shared)로 분리하여 동기화 부담 제거.
