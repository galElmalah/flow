import { SeedNode } from "./SeedNode.jsx";
import { PromptNode } from "./PromptNode.jsx";
import { DatasetNode } from "./DatasetNode.jsx";
import { PromptSetNode } from "./PromptSetNode.jsx";
import { FilterNode } from "./FilterNode.jsx";
import { SectionNode } from "./SectionNode.jsx";
import { TemplateNode } from "./TemplateNode.jsx";
import { AIPromptNode } from "./AIPromptNode.jsx";
import { VariationsNode } from "./VariationsNode.jsx";
import { GenerateNode } from "./GenerateNode.jsx";
import { OutputNode } from "./OutputNode.jsx";
import { VideoGenerateNode } from "./VideoGenerateNode.jsx";
export const nodeTypes = {
  image: SeedNode,
  prompt: PromptNode,
  dataset: DatasetNode,
  "prompt-set": PromptSetNode,
  template: TemplateNode,
  filter: FilterNode,
  section: SectionNode,
  "prompt-generate": AIPromptNode,
  variations: VariationsNode,
  generate: GenerateNode,
  "video-generate": VideoGenerateNode,
  "video-output": OutputNode,
  output: OutputNode,
};
