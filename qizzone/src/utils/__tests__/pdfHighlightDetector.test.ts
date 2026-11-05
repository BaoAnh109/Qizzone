import { describe, expect, it } from "vitest";
import { hasYellowBackground } from "@/utils/parsers/pdfHighlightDetector";
function sample(r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(100*20*4);
  for (let i=0;i<100*20;i++) data.set([r,g,b,255],i*4);
  return { data, width:100, height:20 };
}
describe("PDF yellow highlights", () => {
  it("detects yellow", () => expect(hasYellowBackground(sample(255,255,0), {x:2,y:2,width:50,height:12})).toBe(true));
  it("rejects white", () => expect(hasYellowBackground(sample(255,255,255), {x:2,y:2,width:50,height:12})).toBe(false));
});
