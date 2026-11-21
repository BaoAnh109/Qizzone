export type DocumentSourceFormat = "docx" | "pdf" | "image" | "text";
export type DocumentBlockType =
  | "text_span"
  | "paragraph"
  | "list_item"
  | "table"
  | "cell"
  | "image"
  | "formula"
  | "shape"
  | "annotation"
  | "page_break";

export interface DocumentIRStyle {
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  color?: string;
  highlight?: string;
  fontSize?: number;
}

export interface DocumentIRBlock {
  id: string;
  type: DocumentBlockType;
  text?: string;
  normalizedText?: string;
  bbox?: [number, number, number, number];
  readingOrder: number;
  style?: DocumentIRStyle;
  sourceRef: {
    page?: number;
    paragraph?: number;
    run?: number;
    table?: number;
    row?: number;
    cell?: number;
  };
  assetId?: string;
}

export interface DocumentIRPage {
  pageNumber: number;
  width?: number;
  height?: number;
  blocks: DocumentIRBlock[];
}

export interface DocumentIR {
  schemaVersion: "2.0";
  sourceFormat: DocumentSourceFormat;
  sourceHash?: string;
  parserVersion: string;
  pages: DocumentIRPage[];
  /** DOCX has logical flow order before it is rendered; these blocks have no page coordinates. */
  flowBlocks?: DocumentIRBlock[];
  warnings: string[];
}
