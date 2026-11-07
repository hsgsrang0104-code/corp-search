export default async function handler(req, res) {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });

    const corpName = String(req.query.corpName || "").trim();
    const address = String(req.query.address || "").trim();
    const apiKey = process.env.BIZNO_API_KEY;

    if (!corpName) return res.status(400).json({ success: false, error: "상호명을 입력해 주세요." });
    if (!apiKey) return res.status(500).json({ success: false, error: "BIZNO_API_KEY가 설정되지 않았습니다." });

    try {
        const url = new URL("https://bizno.net/api/fapi");
        url.searchParams.set("key", apiKey);
        url.searchParams.set("gb", "3"); // 상호명 검색
        url.searchParams.set("q", corpName);
        if (address) url.searchParams.set("area", address);
        url.searchParams.set("type", "json");

        const response = await fetch(url.toString());
        const rawText = await response.text();

        if (!response.ok) {
            return res.status(502).json({ success: false, error: `비즈노 HTTP 오류: ${response.status}`, detail: rawText.substring(0, 300) });
        }

        const data = JSON.parse(rawText);
        if (data.resultCode !== 0 && data.resultCode !== "0") {
            return res.status(502).json({ success: false, error: "비즈노 API 오류", resultCode: data.resultCode, resultMsg: data.resultMsg || "검색 결과 없음" });
        }

        const items = data.items || [];
        return res.status(200).json({
            success: true,
            totalCount: Number(data.totalCount || items.length),
            items: items
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: "비즈노 API 호출 실패", detail: error.message });
    }
}
