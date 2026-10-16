import { Dummy } from './Dummy';
import type { Processor } from './Processor';
import type { LocalizedText } from '../i18n';

export interface ProcessorDefinition {
  id: string;
  label: string;
  description: LocalizedText;
  create: () => Processor;
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
];
