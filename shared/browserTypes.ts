export type ComponentItem =
  | { type: 'text'; value: string; id?: string }
  | { type: 'image'; value: string; id?: string }
  | { type: 'section'; value: string; btnLabel: string; btnLink: string; id?: string }
  | { type: 'separator'; value?: string; spacing?: 'small' | 'large'; divider?: boolean; large?: boolean; id?: string };

export interface TemplateField {
  key: string;
  group?: string;
  label?: string;
  type: string;
  value: string;
  default?: string;
  components?: boolean;
  maxLength?: number;
  variables?: string[];
}
