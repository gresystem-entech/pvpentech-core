# Charger를 csms와 연결하기 위한 방안
## 서버에서 충전기 provisioning
- 충전기를 출고할 때, 해당 충전기의 시리얼번호와 충전기 ID를 등록한다.
## csms와의 연동방식
- OCPP 1.6 Security Profile 2 적용
- Server auth: Server certificate / Client auth: Password
- websocket 접속 endpoint : wss://{csms 서버 ip address}/{충전기 ID}
- 헤더 예시: Authorization: Basic Q1AwMDAxOktRSFlEY1lBeEl0amp5S2FNbEExSEE9PQ==
## 충전기 설치한 후
- 전원을 넣으면 csms 서버로 POST /auths 접속해서 자신의 시리얼번호를 보내고
- 예시
{
    "origin": "12345678"        #자리 수는 상관없음
}
- 서버로 부터 충전기 ID와 Password를 Rest API를 통해서 받는다.
- 성공 예시
{ 
    "code": 200,
    "status": "OK",
    "message": "Success",
    "timestamp": "2023-09-06 17:20:35",
    "data": { 
        "clientId": "CP0001", 
        "pwd": "KQHYDcYAxItjjyKaMlA1HA==" 
    } 
}
- 실패 예시
{
    "code": 400,
    "status": "Bad Request",
    "message": "Bad Request",
    "errors": null
}
{
    "code": 401,
    "status": "Unauthorized",
    "message": "Unauthorized",
    "errors": null
}
{
    "code": 404,
    "status": "Not Found",
    "message": "Not Found",
    "errors": null
}
{
    "code": 500,
    "status": "Internal Server Error",
    "message": "Internal Server Error",
    "errors": null
}