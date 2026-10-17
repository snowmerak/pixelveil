import { useEffect, useState } from 'react';

export type Locale = 'en' | 'ko';
export type LocalizedText = Record<Locale, string>;

const english = {
  language: 'Language',
  workspaceSubtitle: 'Webcam frame processing workspace',
  startCamera: 'Start camera',
  stopCamera: 'Stop camera',
  processor: 'Processor',
  vlmModel: 'VLM model',
  noSettings: 'This processor has no additional settings.',
  object: 'Object to mosaic',
  objectPlaceholder: 'For example: the coffee mug',
  jevHint: 'One request at a time. Output stays unchanged until detection; cached locations may lag behind movement.',
  remoteProcessing: 'Frames are sent to TypeSafe for detection. Mosaics are applied in your browser.',
  vlmProcessing: 'Frames (up to 1280×720) are sent to the configured VLM server. Mosaics are applied in your browser.',
  original: 'Original',
  webcamInput: 'Webcam input',
  processed: 'Processed output',
  localProcessing: 'Frames are processed locally in your browser.',
  embedding: {
    enable: 'Use embedding pre-check',
    threshold: 'Cosine similarity threshold',
    hint: 'Experimental, not a probability. Below the threshold: skip detection and clear boxes. Errors keep previous boxes. Adjust using real test scores.',
    remoteProcessing: 'The target text and frames up to 320×320 are sent to the configured embedding server before detection. Target embeddings are cached in memory.',
    label: 'Embedding pre-check',
    score: 'Similarity',
    passed: 'Passed',
    skipped: 'Skipped',
    errors: 'Errors',
    text: 'Text',
    frame: 'Frame',
    comparison: 'Compare',
    hintLatency: 'Successful pre-check latency includes target embedding on cache misses, frame encoding/embedding and cosine comparison. Skips are included here, but not in detection percentiles.',
  },
  latency: {
    label: 'Detection latency',
    samples: 'Samples',
    smallSample: 'Fewer than 100 samples; p99 is the maximum.',
    exportLogs: 'Export logs',
    exportHint: 'Download up to 3,000 recent response and applied-box events as JSON. Logs survive camera stops but not page reloads.',
    hint: 'Latest and nearest-rank percentiles of the last 1,000 successful detection cycles, including embedding pre-check when enabled, encoding and API round trips. Skips/errors are excluded. Resets with the camera, target, frame size, processor or embedding settings.',
  },
  status: {
    idle: 'Idle',
    requesting: 'Waiting for camera permission',
    running: 'Live',
    error: 'Error',
  },
  canvas: {
    frameLabel: 'frame',
    unsupported: 'Your browser does not support canvas.',
    waiting: 'Waiting for camera input',
  },
  errors: {
    permissionDenied: 'Camera access was denied. Allow camera access in your browser.',
    notFound: 'No available camera was found.',
    notReadable: 'Unable to read the camera. Check whether another app is using it.',
    startFailed: 'Unable to start the camera. Check its connection and browser permissions.',
    unsupported: 'Camera access is unavailable in this browser. Use HTTPS or localhost.',
    disconnected: 'The camera was disconnected. Start the camera again.',
    canvasUnavailable: 'Canvas 2D rendering is unavailable.',
    processingFailed: 'Frame processing failed.',
  },
};

export type Messages = typeof english;

const korean: Messages = {
  language: '언어',
  workspaceSubtitle: '웹캠 프레임 처리 작업 공간',
  startCamera: '카메라 시작',
  stopCamera: '카메라 중지',
  processor: '프로세서',
  vlmModel: 'VLM 모델',
  noSettings: '현재 프로세서는 별도 설정이 없습니다.',
  object: '모자이크할 객체',
  objectPlaceholder: '예: 커피 머그잔',
  jevHint: '한 번에 하나만 요청합니다. 검출 전에는 원본이 표시되며, 최근 검출 위치는 움직임보다 늦을 수 있습니다.',
  remoteProcessing: '객체 검출을 위해 프레임을 TypeSafe로 전송합니다. 모자이크는 브라우저에서 적용합니다.',
  vlmProcessing: '최대 1280×720 프레임을 설정된 VLM 서버로 전송합니다. 모자이크는 브라우저에서 적용합니다.',
  original: '원본',
  webcamInput: '웹캠 입력',
  processed: '처리 결과',
  localProcessing: '프레임은 브라우저 안에서 처리됩니다.',
  embedding: {
    enable: '임베딩 사전 검사 사용',
    threshold: '코사인 유사도 임계값',
    hint: '확률이 아닌 실험용 점수입니다. 임계값 미만이면 검출을 건너뛰고 박스를 지웁니다. 오류 시 이전 박스를 유지합니다. 실제 점수를 보고 조절하세요.',
    remoteProcessing: '검출 전에 대상 설명과 최대 320×320 프레임을 설정된 임베딩 서버로 전송합니다. 대상 임베딩은 메모리에 캐시합니다.',
    label: '임베딩 사전 검사',
    score: '유사도',
    passed: '통과',
    skipped: '생략',
    errors: '오류',
    text: '텍스트',
    frame: '프레임',
    comparison: '비교',
    hintLatency: '성공한 사전 검사의 지연은 캐시 미스 시 대상 임베딩, 프레임 인코딩·임베딩 및 코사인 비교를 포함합니다. 생략된 주기도 여기에는 포함하지만 검출 백분위수에서는 제외합니다.',
  },
  latency: {
    label: '검출 지연',
    samples: '표본 수',
    smallSample: '표본 100개 미만: p99는 최댓값입니다.',
    exportLogs: '로그 내보내기',
    exportHint: '최근 응답·박스 적용 이벤트 최대 3,000개를 JSON으로 받습니다. 카메라 중지 후에도 유지되지만 페이지 새로고침 시 사라집니다.',
    hint: '활성화된 임베딩 사전 검사, 인코딩과 API 왕복을 포함한 최근 성공 검출 1,000개의 최신값과 최근접 순위 백분위수입니다. 생략·오류는 제외하며 카메라·대상·프레임 크기·프로세서·임베딩 설정 변경 시 초기화합니다.',
  },
  status: {
    idle: '대기 중',
    requesting: '카메라 권한 확인 중',
    running: '실시간 입력 중',
    error: '오류',
  },
  canvas: {
    frameLabel: '프레임',
    unsupported: '이 브라우저는 캔버스를 지원하지 않습니다.',
    waiting: '카메라 입력 대기 중',
  },
  errors: {
    permissionDenied: '카메라 접근이 거부되었습니다. 브라우저에서 카메라 권한을 허용해 주세요.',
    notFound: '사용 가능한 카메라를 찾지 못했습니다.',
    notReadable: '카메라를 읽을 수 없습니다. 다른 앱에서 사용 중인지 확인해 주세요.',
    startFailed: '카메라를 시작하지 못했습니다. 연결 상태와 브라우저 권한을 확인해 주세요.',
    unsupported: '이 브라우저에서 카메라를 사용할 수 없습니다. HTTPS 또는 localhost로 접속해 주세요.',
    disconnected: '카메라 연결이 종료되었습니다. 다시 시작해 주세요.',
    canvasUnavailable: 'Canvas 2D 렌더링을 사용할 수 없습니다.',
    processingFailed: '프레임 처리에 실패했습니다.',
  },
};

const translations: Record<Locale, Messages> = { en: english, ko: korean };
const storageKey = 'pixelveil.locale';

function getInitialLocale(): Locale {
  try {
    return localStorage.getItem(storageKey) === 'ko' ? 'ko' : 'en';
  } catch {
    return 'en';
  }
}

export function useLocale() {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(storageKey, locale);
    } catch {
      return;
    }
  }, [locale]);

  return { locale, setLocale, messages: translations[locale] };
}
