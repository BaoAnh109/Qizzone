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
  it("rejects grey text and white backgrounds", () => expect(hasYellowBackground(sample(140,140,140), {x:2,y:2,width:50,height:12})).toBe(false));
  it("accepts a narrow yellow answer highlight", () => {
    const image = sample(255,255,255);
    for (let y = 3; y < 15; y++) for (let x = 5; x < 38; x++) {
      image.data.set([255,255,0,255], (y*image.width+x)*4);
    }
    expect(hasYellowBackground(image, {x:2,y:2,width:65,height:14})).toBe(true);
    expect(hasYellowBackground(image, {x:70,y:2,width:25,height:14})).toBe(false);
  });
});
