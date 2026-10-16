# Pixelveil

Vite + React + TypeScript 기반 웹캠 프레임 처리 실험용 골격입니다. UI는 `merak-protocol-design-system`의 CSS와 토큰을 사용합니다.

UI는 기본 영어이며 헤더의 **Language** 선택에서 한국어로 전환할 수 있습니다. 선택한 언어는 로컬 저장소에 보관되어 새로고침 후에도 유지됩니다. 번역은 `src/i18n.ts`에서 관리하며, 프로세서 설명은 등록 목록에 언어별로 작성합니다.

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
- `src/processors/registry.ts`: UI에 표시할 프로세서 이름, 설명, 생성 함수
- `src/helpers/`: bbox 영역 모자이크 등 프레임 처리 헬퍼
- `src/hooks/useWebcamProcessor.ts`: 카메라 스트림 수명과 프레임 처리 루프
- `src/components/FrameCanvas.tsx`: 원본·처리 결과 캔버스
- `src/App.tsx`: 프로세서 선택 및 카메라 제어 UI

## 프로세서 추가

1. `Processor`를 구현하는 클래스를 `src/processors/`에 추가합니다.
2. `processorDefinitions`에 고유한 `id`, `label`, `description`, `create`를 등록합니다.
3. 알고리즘에 조절할 값이 생기면 프로세서 설정 영역에 해당 컨트롤을 추가합니다. 현재는 `Dummy`만 있으며 별도 설정값은 없습니다.

프레임 처리 순서는 `video → 원본 canvas → ImageData → Processor.process → 결과 canvas`입니다. 입력은 RGBA `ImageData`이며 기본 `Dummy`는 같은 객체를 반환합니다. 프로세서는 동기 방식이고, 필요하면 입력을 직접 변경하거나 다른 크기의 `ImageData`를 반환할 수 있습니다. 원본 캔버스는 처리 전에 그려지므로 입력 객체를 변경해도 원본 화면에는 영향을 주지 않습니다.

`process`의 두 번째 인자 `object`는 문자열입니다. `useWebcamProcessor(processor, object)`가 각 프레임과 함께 현재 값을 전달하며, 값이 바뀌면 카메라 스트림을 유지한 채 다음 처리부터 적용합니다. 현재 앱은 빈 문자열 `''`을 전달하고, `Dummy`는 해당 값을 사용하지 않습니다.

프로세서 선택 시 새 인스턴스를 생성해 다음 프레임부터 적용하며 카메라 스트림은 유지합니다. 카메라 중지·컴포넌트 해제 시 스트림 트랙과 렌더링 루프를 정리합니다. 프레임은 브라우저 내 메인 스레드에서 처리하며 외부로 전송하지 않습니다. 무거운 알고리즘을 추가할 때 Worker 등은 별도로 검토하면 됩니다.

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
