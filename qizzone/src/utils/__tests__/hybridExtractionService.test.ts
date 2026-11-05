import { describe, expect, it } from "vitest";
import { assertQuestionCoverage, mergeAIRecovery, needsAIRecovery } from "@/services/hybridExtractionService";
import type { ExtractionResult } from "@/types/extractor";

const q = {
  id:"q1", tempId:"t1", order:1, content:"Câu hỏi?",
  options: [{id:"A" as const, content:"Một", rawContent:"A. Một"}, {id:"B" as const, content:"Hai", rawContent:"B. Hai"}],
  correctAnswers: ["B" as const], points:1, confidenceScore:0.99,
  detectionStrategy: "answer_table" as const, rawTextSegment:"Câu hỏi?",
};
const base: ExtractionResult = {fileName:"test.pdf",fileType:"pdf",fileSize:10,title:"Test",subject:"ATTT",
  totalQuestionsDetected:1,questions:[q],hasAnswerKeyTable:true,warningsCount:0,extractedAt:"2026-01-01"};
describe("hybrid recovery", () => {
 it("rejects documents that contain more numbered questions than parsed",()=>{
   expect(() => assertQuestionCoverage("Câu 1. A\nCâu 2. B", base)).toThrow("2 đầu mục");
 });

 it("does not invoke fallback for missing answers alone",()=>{
   expect(needsAIRecovery({...base,questions:[{...q,correctAnswers:[]}]})).toBe(false);
 });
 it("flags structurally missing choices",()=>{
   expect(needsAIRecovery({...base,questions:[{...q,options:[]}]})).toBe(true);
 });
 it("keeps source answer instead of AI guess when existing question is valid",()=>{
   const incoming = {...base,questions:[{...q,correctAnswers:["A" as const],detectionStrategy:"ai_inference" as const}]};
   expect(mergeAIRecovery(base,incoming).questions[0].correctAnswers).toEqual(["B"]);
 });
});
