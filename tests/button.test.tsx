import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, buttonVariants } from "@/components/ui/button";

describe("shadcn Button", () => {
  it("keeps size classes independent from color variants", () => {
    for (const size of ["default", "sm", "icon"] as const) {
      for (const variant of ["outline", "ghost", "destructive"] as const) {
        const classes = buttonVariants({ variant, size }).split(" ");
        expect(classes).not.toContain("bg-primary");
        expect(classes).not.toContain("text-primary-foreground");
      }
    }
    expect(buttonVariants()).toContain("bg-primary text-primary-foreground");
    expect(buttonVariants({ variant: "outline" })).toContain("text-foreground");
    expect(buttonVariants({ variant: "destructive" })).toContain(
      "text-destructive",
    );
  });

  it("renders the Base UI button with the shadcn slot and disabled state", () => {
    const html = renderToStaticMarkup(
      <Button variant="outline" disabled>
        Fetch
      </Button>,
    );
    expect(html).toContain('data-slot="button"');
    expect(html).toContain("disabled");
    expect(html).toContain("bg-background");
    expect(html).not.toContain("button-default");
  });
});
