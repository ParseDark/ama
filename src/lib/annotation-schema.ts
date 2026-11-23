import { z } from "zod";

export const ANNOTATION_LIMITS = {
  batch: 32,
  marks: 128,
  points: 128,
  text: 160,
} as const;
const fraction = z.number().min(0).max(1);
const point = z.strictObject({ x: fraction, y: fraction });
const color = z
  .enum(["red", "orange", "blue", "green", "purple", "white"])
  .optional();
const shape = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["line", "arrow", "ellipse"]),
    from: point,
    to: point,
    color,
  }),
  z.strictObject({
    kind: z.literal("polyline"),
    points: z.array(point).min(2).max(ANNOTATION_LIMITS.points),
    color,
  }),
  z.strictObject({
    kind: z.literal("label"),
    at: point,
    text: z.string().min(1).max(ANNOTATION_LIMITS.text),
    color,
  }),
]);
const id = z.string().min(1).max(64);
// Keep the tool parameter root an object (also required by OpenAI-compatible APIs).
export const annotationInput = z.strictObject({
  operation: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("add"),
      shapes: z.array(shape).min(1).max(ANNOTATION_LIMITS.batch),
    }),
    z.strictObject({ action: z.literal("replace"), id, shape }),
    z.strictObject({ action: z.literal("remove"), id }),
    z.strictObject({ action: z.literal("clear") }),
  ]),
});
export type AnnotationOperation = z.infer<typeof annotationInput>["operation"];
export type AnnotationShape = z.infer<typeof shape>;
