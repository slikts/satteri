export { ArenaReader, NodeType, NodeTypeName } from "./arena-reader.js";
export { DataMap } from "./data-map.js";
export { materializeNode, materializeTree, TYPE_NAMES } from "./materializer.js";
export { visitArena, MutationType } from "./visitor.js";
export { definePlugin } from "./plugin.js";
export { createProcessor, ProcessorContext } from "./processor.js";
export {
  parseToBuffer,
  parseToHastBuffer,
  mdastBufferToHastBuffer,
  hastBufferToHtmlStr,
  compileMdx,
  compileMdxFromBuffer,
  parseToHtml,
  parseMdxToHtml,
} from "../index.js";

// HAST support
export {
  HastArenaReader,
  HAST_ROOT,
  HAST_ELEMENT,
  HAST_TEXT,
  HAST_COMMENT,
  HAST_DOCTYPE,
  HAST_RAW,
  PROP_STRING,
  PROP_BOOL_TRUE,
  PROP_BOOL_FALSE,
  PROP_SPACE_SEP,
  PROP_COMMA_SEP,
} from "./hast-reader.js";
export type { HastProperty } from "./hast-reader.js";
export { materializeHastNode, materializeHastTree } from "./hast-materializer.js";
export type { HastNode } from "./hast-materializer.js";
export { visitHastArena } from "./hast-visitor.js";
export type {
  HastVisitorInstance,
  HastVisitorContext,
  VisitResult as HastVisitResult,
} from "./hast-visitor.js";

export type { MdastNode, Position, Point } from "./types.js";
