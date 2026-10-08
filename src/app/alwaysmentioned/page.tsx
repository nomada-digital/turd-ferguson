import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import PackagePage from "@/components/PackagePage";
import { listIf, onlyIf } from "@/config/capabilities";
import { priceProse, TIERS } from "@/config/pricing";

const tier = TIERS.find((t) => t.id === "mentioned")!;
const price = priceProse(tier);

export const metadata: Metadata = {
  title: "alwaysmentioned | AI citation placements",
  description:
    // "white-labelled" and the reporting line below claim a dashboard and a
    // report in the agency's brand, neither built yet (LB1, 8 Oct 2026).
    "Three placements a month in the sources AI engines already cite for your client's topic" +
    (onlyIf("dashboardBranding", ", white-labelled") ?? "") +
    "." +
    (price ? ` ${price}, priced per topic.` : ""),
  openGraph: { url: "https://alwayscited.com/alwaysmentioned", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/alwaysmentioned" },
};

export default function Page() {
  return (
    <PackagePage
      tier={tier}
      headline="Get named when"
      headlineAccent="AI recommends."
      standfirst="Three placements a month in the third-party articles the engines draw on when someone asks who to use. The focus is recommendations and brand mentions for one topic. Rankings improve as a side effect."
      included={[
        "3 placements a month on one topic",
        "The cluster you track is the one you upgrade: the same keyword and prompts, now worked on",
        "Placed in sources the scan shows the engines already citing",
        "Best-of lists, comparisons and round-ups, approached through editors we work with",
        "Anchor text agreed with you before anything goes live",
        "Everything in alwaystracked, so you can see what each placement did",
        ...listIf("reportBranding", "White-label reporting with your logo"),
      ]}
      notIncluded={{
        text: "This package wins the mention. It does not do on-page work. For schema and link insertions that go after the Google position directly, that is",
        upgradeTo: "cited",
        href: "/alwayscited",
      }}
      sections={[
        {
          figure: "Screened",
          heading: "Every placement passes the same three-part screen",
          body: "Already cited by the engines for the topic, so we place where the answers are actually drawn from rather than on a domain-authority list. Real organic traffic, verified rather than claimed. And contextual to the topic, so the mention reads as part of the page to a person and to a model.",
        },
        {
          figure: "Replaced",
          heading: "A placement that fails the screen is replaced",
          body: "Not counted. You are buying placements that passed, not attempts. If a publication drops out or the piece never runs, it does not come off your three.",
        },
        {
          figure: "Mentions",
          heading: "A mention can win the citation without a link",
          body: "Across our own coverage, the citations came from pieces with no link in them. Coverage and links do different jobs, and this package is aimed at the first one. The tracker reports which happened.",
        },
        {
          figure: "Per topic",
          heading: "Priced per topic",
          body: "You name the topic, we build the prompts buyers actually ask around it - the longer-tail prompts people use when they are choosing a provider. One topic per plan, so the work stays focused enough to move.",
        },
      ]}
    />
  );
}
