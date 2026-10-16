# Pixelveil

Vite + React + TypeScript 기반 웹캠 프레임 처리 실험용 골격입니다. UI는 `merak-protocol-design-system`의 CSS와 토큰을 사용합니다.

UI는 기본 영어이며 헤더의 언어 선택에서 한국어로 전환할 수 있습니다. 선택한 언어는 로컬 저장소에 보관되어 새로고침 후에도 유지됩니다. 번역은 `src/i18n.ts`에서 관리하며, 프로세서 설명은 등록 목록에 언어별로 작성합니다.

## 실행

Node.js 22.13 이상(22.x) 또는 24 이상과 pnpm 10.28.1을 사용합니다.

`pnpm-workspace.yaml`은 Windows ARM에서 pnpm과 Node.js의 실행 아키텍처가 다른 경우에도 빌드할 수 있도록 현재 아키텍처와 ARM64 네이티브 의존성을 함께 설치합니다.

```sh
pnpm install
pnpm dev
```

브라우저에서 표시된 localhost 주소를 열고 **카메라 시작**을 누른 뒤 카메라 권한을 허용합니다. 원본과 처리 결과는 나란히 표시되며, 좁은 화면에서는 세로로 배치됩니다. 카메라 사용에는 localhost 또는 HTTPS가 필요합니다.

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

## 구조

- `src/processors/Processor.ts`: `process(inputFrame: ImageData, object: string): ImageData` 인터페이스
- `src/processors/Dummy.ts`: 전달받은 프레임을 그대로 반환하는 기본 구현
- `src/processors/JevProcessor.ts`: 프레임 드롭, 최근 bbox 적용, 검출 주기와 취소 상태 관리
- `src/processors/JevSimple.ts`: 단일 객체 검출 프로세서
- `src/processors/JevScroll.ts`: 최대 6개 객체 검출 프로세서
- `src/processors/jevClient.ts`: 이미지 인코딩, Choice·Box·존재 여부 요청, 응답 검증
- `server/jevProxy.ts`: 개발·미리보기 서버의 TypeSafe API 프록시
- `src/processors/registry.ts`: UI에 표시할 프로세서 이름, 설명, 생성 함수
- `src/helpers/`: bbox 영역 모자이크 등 프레임 처리 헬퍼
- `src/hooks/useWebcamProcessor.ts`: 카메라 스트림 수명과 프레임 처리 루프
- `src/components/FrameCanvas.tsx`: 원본·처리 결과 캔버스
- `src/App.tsx`: 프로세서 선택 및 카메라 제어 UI

## 프로세서 추가

1. `Processor`를 구현하는 클래스를 `src/processors/`에 추가합니다.
2. `processorDefinitions`에 고유한 `id`, `label`, `description`, `create`를 등록합니다.
3. 알고리즘에 조절할 값이 생기면 프로세서 설정 영역에 해당 컨트롤을 추가합니다. `requiresObject: true`이면 대상 설명 입력창을 표시합니다.

프레임 처리 순서는 `video → 원본 canvas → ImageData → Processor.process → 결과 canvas`입니다. 입력은 RGBA `ImageData`이며 기본 `Dummy`는 같은 객체를 반환합니다. 프로세서는 동기 방식이고, 필요하면 입력을 직접 변경하거나 다른 크기의 `ImageData`를 반환할 수 있습니다. 원본 캔버스는 처리 전에 그려지므로 입력 객체를 변경해도 원본 화면에는 영향을 주지 않습니다.

`process`의 두 번째 인자 `object`는 문자열입니다. `useWebcamProcessor(processor, object)`가 각 프레임과 함께 입력창의 현재 값을 전달하며, 값이 바뀌면 카메라 스트림을 유지한 채 다음 처리부터 적용합니다. `Dummy`는 해당 값을 사용하지 않습니다.

프로세서 선택 시 새 인스턴스를 생성해 다음 프레임부터 적용하며 카메라 스트림은 유지합니다. 카메라 중지·컴포넌트 해제 시 스트림 트랙과 렌더링 루프를 정리하고, 선택적 `reset()`으로 프로세서의 진행 중인 작업과 캐시를 초기화합니다. 모자이크 연산은 브라우저 내 메인 스레드에서 처리합니다. `Dummy`는 외부로 프레임을 보내지 않으며 Jev 프로세서는 검출할 프레임을 TypeSafe로 전송합니다.

## Jev · Simple decision

1. `.env.example`을 `.env.local`로 복사하고 `TYPESAFE_API_KEY`에 실제 키를 설정합니다. 키는 로컬 서버에서만 읽으며 `VITE_` 접두사를 붙이지 않습니다.
2. `pnpm dev` 또는 `pnpm build` 후 `pnpm preview`로 실행합니다.
3. 프로세서에서 **Jev · Simple decision**을 선택하고 **Object to mosaic**에 대상 설명을 입력한 뒤 카메라를 시작합니다.

`process`는 동기적으로 현재 프레임을 반환합니다. 진행 중인 검출이 없을 때만 원본 프레임을 PNG로 캡처해 요청합니다. 이미지 인코딩·업로드·응답 대기 중 추가 프레임은 검출 대상으로 버리며 별도 큐를 만들지 않습니다. 화면은 최근 검출 bbox로 계속 모자이크합니다. 응답이 도착하면 bbox만 갱신하고, 다음에 들어온 새 프레임이 다음 요청을 시작합니다.

대상 설명·프레임 크기가 바뀌거나 카메라 중지·프로세서 교체·컴포넌트 해제가 발생하면 캐시를 비우고 기존 요청을 취소합니다. 취소가 늦게 처리돼도 이전 응답과 오류는 세대 번호로 무시합니다. 취소된 작업이 끝나기 전에는 같은 인스턴스에서 새 요청을 시작하지 않습니다.

- 모델은 `jev-preview`입니다. 한 요청에 Box 하나와 Noul 존재 여부 질의를 함께 보냅니다. 존재 확률이 `0.5` 미만이면 캐시를 비웁니다. 이는 PoC 기본 임계값입니다.
- [Box 공식 문서](https://docs.typesafe.ai/primitives/box)의 정규화 좌표를 현재 프레임의 픽셀 bbox로 변환합니다. [이미지 규격](https://docs.typesafe.ai/images)에 맞춰 각 변을 280~1568px로 조정합니다. 작은 영상이나 극단적인 종횡비에서는 비율이 달라질 수 있으나 전체 프레임에 대한 정규화 좌표를 유지합니다.
- 프레임은 모자이크 전에 캡처합니다. 요청하지 않는 프레임은 추가 복사·PNG 변환·업로드하지 않습니다.
- 첫 검출 전이나 대상 설명이 비어 있으면 원본을 표시합니다. 대기 중 bbox는 이전 위치이므로 빠른 움직임을 추적하거나 완전한 가림을 보장하지 않습니다.
- 실패하면 다음 `process` 호출에서 오류를 전달해 카메라를 중지합니다. 수정 후 카메라를 다시 시작해 재시도합니다. 자동 재시도는 하지 않습니다.
- `JEV_TIMEOUT_MS`는 서버 요청 제한 시간이며 기본 30000ms입니다. 환경값 변경은 Vite를 재시작해야 반영됩니다.
- `/api/jev`는 Vite 개발 서버와 미리보기 서버에서 제공합니다. 정적 `dist`만 배포할 때는 같은 경로의 서버 프록시를 별도로 준비해야 합니다.

## Jev · Scroll decision

같은 API 키 설정으로 프로세서에서 **Jev · Scroll decision**을 선택하고 대상 설명을 입력합니다. 한 검출 주기는 다음과 같습니다.

1. 원본 프레임을 PNG로 한 번만 인코딩합니다.
2. **최초 주기에만** [Choice 질의](https://docs.typesafe.ai/primitives/choice)로 객체 수를 `0 / 1 / 2 / 3 / 4 / 5 / 6개 이상` 중 선택합니다. `0`이면 bbox 캐시를 비우고 주기를 마칩니다. 그 외에는 같은 PNG로 선택된 개수만큼의 Box 요청을 보냅니다.
3. **다음 주기부터는 Choice를 생략**하고 `min(이전 유효 bbox 수 + 1, 6)`개의 Box를 한 요청으로 질의합니다. 각 순번의 객체가 실제로 존재하는지 확인하는 Noul도 같은 요청에 포함합니다. 각 질의는 위쪽 변의 위치를 기준으로 위→아래, 동률이면 왼쪽 변 기준 왼쪽→오른쪽으로 정렬한 N번째 객체 하나를 지정합니다. 요청 개수를 실제 총개수로 단정하는 프롬프트는 사용하지 않습니다.
4. 순번별 존재 확률이 `0.5` 이상인 유효 bbox만 채택하고 그 수를 다음 주기의 기준으로 사용합니다. 예를 들어 이전 검출이 2개면 다음에는 3개를 요청하고, 그중 1개만 존재하면 다음 요청은 2개가 됩니다. 0개로 줄어도 이후 매 주기 1개를 탐색하므로 객체가 다시 나타날 수 있습니다.
5. 응답 전체를 검증한 뒤 bbox 캐시와 개수를 한 번에 갱신합니다. 필수 존재 여부 응답 누락, 존재한다고 답한 슬롯의 잘못된 좌표, 요청 실패는 오류로 처리하며 일부 bbox만 적용하지 않습니다. 존재하지 않는 슬롯의 Box는 무시합니다.

인코딩부터 마지막 응답까지 전체 주기 동안 추가 프레임은 검출 대상으로 드롭합니다. 최초에는 최대 두 번, 이후에는 한 번의 HTTP 요청을 보내며 렌더링에는 이전 주기의 bbox들을 계속 사용합니다. 응답이 끝난 뒤 들어오는 새 프레임으로 다음 주기를 시작합니다. 대상·프레임 크기 변경, 중지·교체 시 이전 개수도 초기화하므로 다음 주기는 다시 Choice부터 시작합니다. 취소된 주기의 응답은 bbox·개수·지연 측정에 반영하지 않습니다.

Box에는 ‘없음’ 응답이 없으므로 단순한 Box 응답 수를 실제 개수로 사용할 수 없습니다. 여기서 유효 개수는 순번별 Noul 판단과 좌표 검증을 통과한 bbox의 수이며, 실제 객체 수를 보장하는 값은 아닙니다. 이 구현은 모델의 존재 여부·순서 판단을 실험하는 PoC입니다. 실제로 서로 다른 객체를 모두 찾거나 중복 bbox를 피하는 정확도를 보장하지 않습니다. 한 번에 늘릴 수 있는 탐색 수는 이전 검출 수보다 1개이며 최대 6개입니다. 키 설정·프록시·타임아웃·첫 검출 전 원본 표시 동작은 Simple decision과 같습니다. 타임아웃은 각 HTTP 요청에 별도로 적용됩니다.

## 검출 지연 표시

화면 우하단에 최근 성공적으로 완료된 Jev 검출 주기의 경과 시간을 밀리초(`ms`)로 표시합니다. `performance.now()`로 검출 시작부터 bbox 응답 검증 완료까지 측정하며, PNG 인코딩·업로드·서버 프록시·API 왕복이 포함됩니다. Scroll의 최초 주기는 개수 확인과 Box 요청을 모두 포함하고, 최초에 0개 응답이면 개수 확인 완료까지 측정합니다. 이후에는 Box·존재 여부를 묶은 단일 요청 시간을 포함합니다. 카메라 캡처와 모자이크 렌더링 시간은 포함하지 않습니다.

다음 요청이 진행 중이어도 최근 완료 값을 유지합니다. 첫 응답 전, Dummy 선택, 대상·프레임 크기 변경, 카메라 중지·프로세서 교체 시에는 `—`로 표시합니다. 취소·실패·이전 세대 응답은 새 측정값으로 반영하지 않습니다. 표시값은 검출 완료·초기화 시에만 구독을 통해 갱신하므로 매 프레임 React 렌더링을 유발하지 않습니다.

## 영역 모자이크 헬퍼

`mosaicRegion(frame, bboxes, blockSize = 12)`는 bbox 배열을 받아 각 영역 내부의 블록을 RGB 평균색으로 채웁니다. 입력 `ImageData`를 **직접 변경하고 같은 객체를 반환**하므로 프로세서의 `process` 안에서 바로 사용할 수 있습니다. 알파값과 모든 bbox 밖 픽셀은 유지합니다.

```ts
import { mosaicRegion } from './helpers';
import type { BoundingBox } from './helpers';

const bboxes: BoundingBox[] = [
  { x: 100, y: 80, width: 240, height: 180 },
  { x: 500, y: 120, width: 160, height: 160 },
];
const outputFrame = mosaicRegion(inputFrame, bboxes, 16);
```

- bbox는 프레임 좌상단을 원점으로 하는 픽셀 좌표 `{ x, y, width, height }`입니다.
- 소수 좌표는 좌상단을 내림, 우하단을 올림하여 걸치는 픽셀을 포함합니다. 프레임 바깥 영역은 잘라냅니다.
- 블록은 잘라낸 bbox의 좌상단에서 시작하며, 가장자리의 작은 블록은 해당 영역만 평균냅니다.
- 빈 배열이면 변경 없이 반환합니다. 너비·높이가 0 이하이거나 프레임과 겹치지 않는 bbox는 건너뛰고 나머지 영역을 처리합니다.
- 배열 순서대로 처리하며 겹치는 영역은 앞선 처리 결과에 다시 모자이크를 적용합니다.
- bbox 값이 `NaN`/무한대이거나 블록 크기가 양의 안전한 정수가 아니면 프레임을 변경하기 전에 `RangeError`를 발생시킵니다. 블록 크기 1은 원본 픽셀을 유지합니다.
- 원본 객체를 보존해야 한다면 `mosaicRegion(new ImageData(new Uint8ClampedArray(inputFrame.data), inputFrame.width, inputFrame.height, { colorSpace: inputFrame.colorSpace }), bboxes)`처럼 먼저 복사합니다.
