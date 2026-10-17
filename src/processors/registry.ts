import { Dummy } from './Dummy';
import { JevSimple } from './JevSimple';
import { JevScroll } from './JevScroll';
import { JevPanning } from './JevPanning';
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
      en: 'Detects one matching object with Jev; requires presence ≥ 0.5 and box confidence ≥ 0.15.',
      ko: 'Jev로 객체 하나를 검출하며 존재 확률 0.5 이상, Box confidence 0.15 이상만 적용합니다.',
    },
    create: () => new JevSimple(),
    requiresObject: true,
  },
  {
    id: 'jev-scroll',
    label: 'Jev · Scroll decision',
    description: {
      en: 'Counts once, then probes one extra object up to six; requires presence ≥ 0.2 and box confidence ≥ 0.1.',
      ko: '최초 개수 확인 후 이전 검출 수+1개(최대 6개)를 요청하며 존재 확률 0.2·Box confidence 0.1 이상만 적용합니다.',
    },
    create: () => new JevScroll(),
    requiresObject: true,
  },
  {
    id: 'jev-panning',
    label: 'Jev · Panning decision',
    description: {
      en: 'Requires any-object presence ≥ 0.5; prefers smaller overlapping boxes, with no box confidence cutoff.',
      ko: '전체 존재 확률 0.5 이상이면 confidence 제한 없이 겹치는 박스 중 작은 영역을 우선합니다.',
    },
    create: () => new JevPanning(),
    requiresObject: true,
  },
];
