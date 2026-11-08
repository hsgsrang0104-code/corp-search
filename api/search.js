export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });
    }

    const corpName = String(req.query.corpName || "").trim();
    const queryBizno = String(req.query.bizno || "").trim();
    const queryAddress = String(req.query.address || "").trim();

    if (!corpName && !queryBizno) {
        return res.status(400).json({ success: false, error: "상호명이나 사업자등록번호가 전달되지 않았습니다." });
    }

    const biznoApiKey = process.env.BIZNO_API_KEY;
    const npsApiKey = process.env.DATA_GO_KR_API_KEY || process.env.NPS_API_KEY;

    function formatBizNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 10) return value || "정보없음";
        return number.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");
    }

    function normalize(value) {
        return String(value || "")
            .replace(/주식회사|㈜|\(주\)|주\)/g, "")
            .replace(/\s/g, "")
            .replace(/[()（）]/g, "")
            .toLowerCase();
    }

    try {
        // =========================================================
        // [1단계] 비즈노 API로 상호 검색 및 사업자번호/기본정보 확보
        // =========================================================
        if (!queryBizno) {
            if (!biznoApiKey) {
                return res.status(500).json({ success: false, error: "BIZNO_API_KEY가 설정되지 않았습니다." });
            }

            const biznoUrl = `https://bizno.net/api/fapi?key=${encodeURIComponent(biznoApiKey)}&gb=3&q=${encodeURIComponent(corpName)}&type=json`;
            const biznoRes = await fetch(biznoUrl);

            if (!biznoRes.ok) {
                throw new Error(`비즈노 API 통신 실패 (HTTP ${biznoRes.status})`);
            }

            const biznoData = await biznoRes.json();
            if (biznoData.resultCode !== 0 && biznoData.resultCode !== "0") {
                return res.status(404).json({ success: false, error: biznoData.resultMsg || "비즈노 검색 결과가 없습니다." });
            }

            const rawItems = biznoData.items;
            let itemList = [];
            if (Array.isArray(rawItems)) {
                itemList = rawItems.filter(item => item && typeof item === 'object');
            } else if (rawItems && typeof rawItems === 'object') {
                itemList = [rawItems];
            }

            if (itemList.length === 0) {
                return res.status(404).json({ success: false, error: "해당 상호명으로 등록된 기업정보가 비즈노에 없습니다." });
            }

            const searchName = normalize(corpName);
            const candidates = itemList.map(item => {
                const name = item.company || item.name || corpName;
                const bno = item.bno || "";
                const addr = item.address || item.addr || "비즈노 주소 없음";
                const status = item.bstt || item.status || "계속사업자";
                const phone = item.tel || item.phone || "정보없음";

                let score = 0;
                if (normalize(name) === searchName) score += 100;
                if (queryAddress && addr.includes(queryAddress)) score += 50;

                return {
                    corpName: name,
                    bizno: formatBizNo(bno),
                    rawBizno: bno.replace(/\D/g, ""),
                    address: addr,
                    status: status,
                    phone: phone,
                    score: score
                };
            }).sort((a, b) => b.score - a.score);

            return res.status(200).json({
                success: true,
                mode: "list",
                count: candidates.length,
                candidates: candidates
            });
        }

        // =========================================================
        // [2단계] 확보한 사업자번호로 국민연금공단 API 주소 조회 + Fallback 적용
        // =========================================================
        const cleanBizno = queryBizno.replace(/\D/g, "");
        let finalAddress = queryAddress || "비즈노 주소 없음";
        let addressSource = "비즈노";

        if (npsApiKey && cleanBizno.length >= 6) {
            try {
                const npsUrl = "http://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2/getBassInfoSearchV2";
                const params = new URLSearchParams({
                    serviceKey: npsApiKey,
                    bzowrRgstNo: cleanBizno.substring(0, 6), // 앞 6자리 대조
                    wkplNm: corpName,
                    dataType: "json",
                    pageNo: "1",
                    numOfRows: "10"
                });

                const npsRes = await fetch(`${npsUrl}?${params.toString()}`);
                if (npsRes.ok) {
                    const npsData = await npsRes.json();
                    const items = npsData?.response?.body?.items?.item;
                    let npsList = Array.isArray(items) ? items : (items ? [items] : []);

                    const matched = npsList.find(n => {
                        const nBiz = String(n.bzowrRgstNo || "").replace(/\D/g, "");
                        return cleanBizno.startsWith(nBiz.replace(/\*/g, ""));
                    }) || npsList[0];

                    // 국민연금공단 주소가 있으면 우선 적용, 없으면 기존 비즈노 주소 유지
                    if (matched && matched.wkplRoadNmDtlAddr) {
                        finalAddress = matched.wkplRoadNmDtlAddr;
                        addressSource = "국민연금공단";
                    }
                }
            } catch (e) {
                console.warn("국민연금공단 API 조회 실패, 비즈노 주소 사용:", e.message);
            }
        }

        return res.status(200).json({
            success: true,
            mode: "detail",
            corpName: corpName,
            bizno: formatBizNo(cleanBizno),
            phone: req.query.phone || "정보없음",
            status: req.query.status || "계속사업자",
            address: finalAddress,
            addressSource: addressSource,
            source: `비즈노 + ${addressSource}`
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: "서버 처리 중 오류 발생: " + error.message
        });
    }
}
