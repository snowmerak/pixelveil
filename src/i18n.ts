import { useEffect, useState } from 'react';

export type Locale = 'en' | 'ko';
export type LocalizedText = Record<Locale, string>;

const english = {
  language: 'Language',
  workspaceSubtitle: 'Webcam frame processing workspace',
  startCamera: 'Start camera',
  stopCamera: 'Stop camera',
  processor: 'Processor',
  noSettings: 'This processor has no additional settings.',
  object: 'Object to mosaic',
  objectPlaceholder: 'For example: the coffee mug',
  jevHint: 'One request at a time. Output stays unchanged until detection; cached locations may lag behind movement.',
  remoteProcessing: 'Frames are sent to TypeSafe for detection. Mosaics are applied in your browser.',
  original: 'Original',
  webcamInput: 'Webcam input',
  processed: 'Processed output',
  localProcessing: 'Frames are processed locally in your browser.',
  latency: {
    label: 'Detection latency',
    hint: 'Last completed detection cycle, including image encoding and API round trips. Scroll counts objects only on its first cycle.',
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
  noSettings: '현재 프로세서는 별도 설정이 없습니다.',
  object: '모자이크할 객체',
  objectPlaceholder: '예: 커피 머그잔',
  jevHint: '한 번에 하나만 요청합니다. 검출 전에는 원본이 표시되며, 최근 검출 위치는 움직임보다 늦을 수 있습니다.',
  remoteProcessing: '객체 검출을 위해 프레임을 TypeSafe로 전송합니다. 모자이크는 브라우저에서 적용합니다.',
  original: '원본',
  webcamInput: '웹캠 입력',
  processed: '처리 결과',
  localProcessing: '프레임은 브라우저 안에서 처리됩니다.',
  latency: {
    label: '검출 지연',
    hint: '이미지 인코딩과 API 왕복을 포함한 최근 완료 검출 시간입니다. Scroll은 최초 주기에만 객체 수를 확인합니다.',
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
