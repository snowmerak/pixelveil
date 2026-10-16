import { Dummy } from './Dummy';
import { JevSimple } from './JevSimple';
import { JevScroll } from './JevScroll';
import type { Processor } from './Processor';
import type { LocalizedText } from '../i18n';

export interface ProcessorDefinition {
  id: string;
  label: string;
  description: LocalizedText;
  create: () => Processor;
  requiresObject?: boolean;
}

export const processorDefinitions: readonly ProcessorDefinition[] = [
  {
    id: 'dummy',
    label: 'Dummy',
    description: {
      en: 'Returns the input frame unchanged.',
      ko: '입력 프레임을 변경 없이 그대로 반환합니다.',
    },
    create: () => new Dummy(),
  },
  {
    id: 'jev-simple',
    label: 'Jev · Simple decision',
    description: {
      en: 'Detects one matching object with Jev and mosaics its latest location.',
      ko: 'Jev로 일치하는 객체 하나를 검출하고 최근 위치를 모자이크합니다.',
    },
    create: () => new JevSimple(),
    requiresObject: true,
  },
  {
    id: 'jev-scroll',
    label: 'Jev · Scroll decision',
    description: {
      en: 'Counts once, then probes one more object than last detected, up to six.',
      ko: '최초 개수 확인 후 이전 검출 수보다 하나 더 요청하며 최대 6개를 모자이크합니다.',
    },
    create: () => new JevScroll(),
    requiresObject: true,
  },
];
