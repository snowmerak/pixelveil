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
      en: 'Requests six boxes, prompts zeros for missing objects, and keeps boxes with confidence ≥ 0.15 (experimental).',
      ko: 'Box 6개를 요청하고 없는 객체는 영점으로 유도하며, confidence 0.15 이상만 적용합니다 (실험적).',
    },
    create: () => new JevPanning(),
    requiresObject: true,
  },
];
