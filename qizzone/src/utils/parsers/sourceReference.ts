import type { ExtractionResult } from "@/types/extractor";
import type { DocumentIR, DocumentIRBlock } from "@/types/documentIR";

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function blockMatches(block: DocumentIRBlock, query: string): boolean {
  const source = normalizeForMatch(block.normalizedText || block.text || "");
  const target = normalizeForMatch(query);
  if (source.length < 6 || target.length < 6) return false;
  return source.includes(target) || (target.length >= 24 && target.includes(source));
}

/** Links extracted text back to the native blocks used by the source viewer. */
export function attachQuestionSourceReferences(result: ExtractionResult, documentIR: DocumentIR): ExtractionResult {
  const blocks = [...documentIR.pages.flatMap(page => page.blocks), ...(documentIR.flowBlocks || [])];
  const questions = result.questions.map(question => {
    const promptBlocks = blocks.filter(block => blockMatches(block, question.content));
    const optionBlocks = question.options.map(option => blocks.filter(block => blockMatches(block, option.content)));
    const options = question.options.map((option, index) => ({
      ...option,
      sourceRefs: optionBlocks[index].map(block => block.id),
    }));
    const sourceBlocks = [...new Map([...promptBlocks, ...optionBlocks.flat()].map(block => [block.id, block])).values()];
    const sourceRefs = sourceBlocks.map(block => block.id);
    const answerEvidence = (question.answerEvidence || []).map(evidence => {
      const optionTexts = evidence.optionIds
        .map(id => question.options.find(option => option.id === id)?.content || "")
        .filter(Boolean);
      const sourceBlock = blocks.find(block => optionTexts.some(text => blockMatches(block, text)));
      return sourceBlock ? {
        ...evidence,
        sourceText: evidence.sourceText || optionTexts.join("\n"),
        sourceRef: {
          page: sourceBlock.sourceRef.page,
          blockId: sourceBlock.id,
          paragraph: sourceBlock.sourceRef.paragraph,
          run: sourceBlock.sourceRef.run,
        },
      } : evidence;
    });
    return {
      ...question,
      content: question.content.replace(/\[Hình ảnh\]/gi, "").trim(),
      promptSourceRefs: promptBlocks.map(block => block.id),
      options: options.map(option => ({ ...option, content: option.content.replace(/\[Hình ảnh\]/gi, "").trim() })),
      sourceRefs,
      answerEvidence,
    };
  });
  return { ...result, questions };
}
