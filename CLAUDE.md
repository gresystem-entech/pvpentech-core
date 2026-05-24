# Pvpentech 프로젝트 컨텍스트

## 프로젝트 개요

전기차 충전 서비스 CSMS (Charge Station Management System).
OCPP 1.6 기반 충전기 관제 서버 + 모바일 앱 충전 API + 사용자 포털

## 경과 조치
fastapi와 django 기반으로 작성된 아키텍쳐를 Node.js 기반으로 변경하여 완성
데이터베이스는 Postgresql을 사용할 것
documents/design_ref에 있는 문서들을 참조하여 새로운 design guide를 documents/design_guide에 저장

## 다국어 지원 (I18N) - 필수 요구사항
- **지원 언어**: 한국어(ko) / 영어(en) / 베트남어(vi) — 3개 언어 필수 지원
- 모든 사용자 노출 메시지, 메뉴, 에러 응답, 알림 등은 반드시 3개 언어로 제공되어야 함
- 백엔드 API 에러 메시지 및 응답 메시지도 Accept-Language 헤더 또는 사용자 설정 언어에 따라 다국어로 반환
- 프론트엔드(모바일 앱, 관리자 포털)도 i18n 라이브러리를 통해 언어 전환 지원
- 번역 파일은 `locales/{언어코드}/` 디렉토리에 JSON 형식으로 관리
- 새로운 메시지/메뉴 추가 시 반드시 ko/en/vi 3개 언어 번역을 모두 작성할 것
- 디자인 가이드 상세: `documents/design_guide/10_i18n_design.md` 참조

## 요청 사항에 대한 수행 방식
- 대화를 통해서 진행되는 모든 사항은 서브에이전트를 통해서 실행
- 모든 기획안 / 코드 작성 내용 / 평가 내용 등은 outputs 폴더에 문서로 저장할 것
- 코드 제작 과정에서 file을 저장하거나 update 하는 경우 확인을 요청하지 말고 그대로 진행할 것
- 코드 제작 과정에서 shell command 실행이 필요할 경우에도 확인을 요청하지 말고 그대로 진행할 것
- 코드 작성이 완료되면 GitHub push까지만 진행할 것. 서버 배포(deploy)는 수동으로 진행하므로 자동 배포하지 말 것



