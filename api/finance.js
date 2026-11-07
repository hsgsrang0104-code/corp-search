export default async function handler(req, res) {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });

    const corpName = String(req.query.corpName || "").trim();
    const apiKey = process.env.DATA_GO_KR_API_KEY;

    if (!corpName) return res.status(400).json({ success: false, error: "상호명이 필요합니다." });
    if (!apiKey) return res.status(500).json({ success: false, error: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." });

    try {
        const baseUrl = "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";
        const params = new URLSearchParams({
            serviceKey: apiKey,
            resultType: "json",
            pageNo: "1",
            numOfRows: "10",
            corpNm: corpName
        });

        const response = await fetch(`${baseUrl}?${params.toString()}`);
        const text = await response.text();

        if (!response.ok) {
            return res.status(502).json({ success: false, error: `금융위원회 HTTP 오류: ${response.status}`, detail: text.substring(0, 300) });
        }

        const data = JSON.parse(text);
        const items = data?.response?.body?.items?.item;
        const itemList = Array.isArray(items) ? items : (items ? [items] : []);

        return res.status(200).json({ success: true, items: itemList });
    } catch (error) {
        return res.status(500).json({ success: false, error: "금융위원회 API 호출 실패", detail: error.message });
    }
}
