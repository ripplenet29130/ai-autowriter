return (
    data.organic_results
      ?.map((item: any) => ({
        source: item.link,
        content: item.snippet,
      }))
      .filter(
        (f: any) =>
          typeof f.content === "string" &&
          f.content.length >= 40
      ) || []
  );
  