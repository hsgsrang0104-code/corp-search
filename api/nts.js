export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST 요청만 허용됩니다." });

    const { b_no } = req.body || {};
    const ntsApiKey = process.env.NTS_API_KEY;

    if (!b_no) return res.status(400).json({ success: false, error: "사업자등록번호가 필요합니다." });
    if (!ntsApiKey) return res.status(500).json({ success: false, error: "NTS_API_KEY가 설정되지 않았습니다." });

    const cleanBno = String(b_no).replace(/\D/g, "");

    try {
        const url = new URL("https://api.odcloud.kr/api/nts-businessman/v1/status");
        url.searchParams.set("serviceKey", ntsApiKey);

        const response = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ b_no: [cleanBno] })
        });

        const text = await response.text();
        if (!response.ok) {
            return res.status(502).json({ success: false, error: `국세청 HTTP 오류: ${response.status}`, detail: text.substring(0, 300) });
        }

        const data = JSON.parse(text);
        const result = (data?.data || []).find(item => String(item.b_no || "").replace(/\D/g, "") === cleanBno);

        let status = "국세청 조회 결과 없음";
        if (result) {
            if (result.b_stt_cd === "01") status = "계속사업자";
            else if (result.b_stt_cd === "02") status = "휴업자";
            else if (result.b_stt_cd === "03") status = "폐업자";
            else status = result.b_stt || "정보 확인 필요";
        }

        return res.status(200).json({ success: true, status });
    } catch (error) {
        return res.status(500).json({ success: false, error: "국세청 API 호출 실패", detail: error.message });
    }
}
