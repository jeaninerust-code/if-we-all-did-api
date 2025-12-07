// pages/[[...catchall]].tsx
// @ts-nocheck

import * as React from "react";
import {
  PlasmicComponent,
  PlasmicRootProvider,
  extractPlasmicQueryData,
} from "@plasmicapp/loader-nextjs";
import Error from "next/error";
import { useRouter } from "next/router";
import { PLASMIC } from "../plasmic/plasmic-init";

// 1. Tell Next.js which Plasmic routes exist
export async function getStaticPaths() {
  const pages = await PLASMIC.fetchPages();

  return {
    paths: pages.map((page) => ({
      params: {
        catchall:
          page.path === "/" ? [] : page.path.substring(1).split("/"),
      },
    })),
    fallback: "blocking",
  };
}

// 2. For each path, fetch the data needed to render it
export async function getStaticProps(context) {
  const { catchall } = context.params ?? {};

  const plasmicPath =
    typeof catchall === "string"
      ? catchall
      : Array.isArray(catchall)
      ? `/${catchall.join("/")}`
      : "/";

  const plasmicData = await PLASMIC.maybeFetchComponentData(plasmicPath);

  if (!plasmicData) {
    // Non-Plasmic route → let Next handle it or 404
    return { props: {} };
  }

  const pageMeta = plasmicData.entryCompMetas[0];

  // Cache Plasmic’s internal query data for this page
  const queryCache = await extractPlasmicQueryData(
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      pageRoute={pageMeta.path}
      pageParams={pageMeta.params}
    >
      <PlasmicComponent component={pageMeta.displayName} />
    </PlasmicRootProvider>
  );

  return {
    props: {
      plasmicData,
      queryCache,
    },
    revalidate: 300, // ok to tweak later
  };
}

// 3. Actually render the page
export default function CatchallPage(props) {
  const { plasmicData, queryCache } = props;
  const router = useRouter();

  if (!plasmicData || plasmicData.entryCompMetas.length === 0) {
    return <Error statusCode={404} />;
  }

  const pageMeta = plasmicData.entryCompMetas[0];

  return (
    <PlasmicRootProvider
      loader={PLASMIC}
      prefetchedData={plasmicData}
      prefetchedQueryData={queryCache}
      pageRoute={pageMeta.path}
      pageParams={pageMeta.params}
      pageQuery={router.query}
    >
      <PlasmicComponent component={pageMeta.displayName} />
    </PlasmicRootProvider>
  );
}
