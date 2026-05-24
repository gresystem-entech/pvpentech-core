import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // Phase 1 monorepo package aliases — map to source directories
    '^@pvpentech/shared$': '<rootDir>/packages/shared/src/index.ts',
    '^@pvpentech/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@pvpentech/core$': '<rootDir>/packages/core/src/index.ts',
    '^@pvpentech/core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@pvpentech/portal$': '<rootDir>/packages/portal/src/index.ts',
    '^@pvpentech/portal/(.*)$': '<rootDir>/packages/portal/src/$1',
    // Short-form aliases (tsconfig paths)
    '^@shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@portal/(.*)$': '<rootDir>/packages/portal/src/$1',
  },
  collectCoverageFrom: [
    'packages/shared/src/**/*.ts',
    'packages/core/src/**/*.ts',
    'packages/portal/src/**/*.ts',
    'apps/server/src/**/*.ts',
    '!**/*.d.ts',
  ],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json',
    },
  },
};

export default config;
