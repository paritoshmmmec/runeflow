/**
 * Notion tool implementations using @notionhq/client.
 * Install: npm install @notionhq/client
 */

async function loadNotion(token) {
  try {
    const { Client } = await import("@notionhq/client");
    return new Client({ auth: token });
  } catch {
    throw new Error("Notion provider requires @notionhq/client.\n  Fix: npm install @notionhq/client");
  }
}

export function notion({ token } = {}) {
  if (!token) {
    throw new Error("notion() requires a token. Pass { token: process.env.NOTION_TOKEN }");
  }

  return {
    "notion.create_page": async ({ parent_id, parent_type, title, content }) => {
      const client = await loadNotion(token);
      const parent = parent_type === "database"
        ? { database_id: parent_id }
        : { page_id: parent_id };

      const children = content ? [{
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content } }] },
      }] : [];

      const page = await client.pages.create({
        parent,
        properties: {
          title: { title: [{ type: "text", text: { content: title } }] },
        },
        children,
      });

      return { id: page.id, url: page.url };
    },

    "notion.query_database": async ({ database_id, filter, limit }) => {
      const client = await loadNotion(token);
      const response = await client.databases.query({
        database_id,
        filter,
        page_size: limit ?? 20,
      });
      return { results: response.results, has_more: response.has_more };
    },
  };
}
