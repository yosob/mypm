import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";

const p = zaiCodingCnProvider();
console.log("provider:", p.id, p.baseUrl);
console.log("models:", p.getModels().map((x: any) => x.id).join(", "));
