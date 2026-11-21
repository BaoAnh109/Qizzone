declare module "mammoth" {
  export interface RawTextResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export interface HtmlResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export interface ExtractOptions {
    arrayBuffer: ArrayBuffer;
    styleMap?: string[];
  }

  export function extractRawText(options: ExtractOptions): Promise<RawTextResult>;
  export function convertToHtml(options: ExtractOptions): Promise<HtmlResult>;
}
