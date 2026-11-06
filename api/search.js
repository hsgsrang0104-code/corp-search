export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "서버 API 키가 설정되지 않았습니다." });
    }

    // (주), 주식회사 및 특수문자/공백 제거 함수
    function cleanCorpName(name) {
        if (!name) return "";
        return name
            .replace(/\(주\)/g, "")
            .replace(/주식회사/g, "")
            .replace(/\(유\)/g, "")
            .replace(/유한회사/g, "")
            .replace(/[^a-zA-Z0-9가-힣]/g, "")
            .trim();
    }

    async function fetchCorpData(nameToSearch) {
        const baseUrl = "https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2";
        const params = new URLSearchParams({
            serviceKey: apiKey,
            resultType: "json",
            pageNo: "1",
            numOfRows: "10",
            corpNm: nameToSearch
        });

        const response = await fetch(`${baseUrl}?${params.toString()}`, { method: "GET" });
        const text = await response.text();
        const data = JSON.parse(text);

        const body = data?.response?.body || {};
        const items = body?.items?.item || [];
        const itemList = Array.isArray(items) ? items : (items ? [items] : []);

        return {
            totalCount: body.totalCount || 0,
            items: itemList
        };
    }

    try {
        let searchName = corpName;
        let result = await fetchCorpData(searchName);

        // 1차 검색 결과가 없으면 정제된 이름으로 재검색
        if (result.totalCount === 0) {
            const cleaned = cleanCorpName(corpName);
            if (cleaned && cleaned !== searchName) {
                result = await fetchCorpData(cleaned);
            }
        }

        // 결과가 없는 경우 모두 "정보없음" 처리
        if (result.totalCount === 0 || result.items.length === 0) {
            return res.status(200).json({
                success: false,
                corpName: "정보없음",
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: address || "정보없음",
                status: "정보없음"
            });
        }

        // 주소가 입력된 경우 일치하는 항목 우선 선택, 없기면 1순위 항목 선택
        let selectedItem = result.items[0];
        if (address) {
            const matched = result.items.find(item => item.enpBsadr && item.enpBsadr.includes(address));
            if (matched) {
                selectedItem = matched;
            }
        }

        return res.status(200).json({
            success: true,
            corpName: selectedItem.corpNm || "정보없음",
            ceoNm: selectedItem.ceoNm || "정보없음",
            bizno: selectedItem.bizNo || "정보없음",
            crno: selectedItem.crno || "정보없음",
            phone: selectedItem.enpTlno || "정보없음",
            address: selectedItem.enpBsadr || "정보없음",
            status: "계속사업자" // 기본 유효 법인 기준 (추후 국세청 API 상태 연동 확장 가능)
        });

    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: "데이터 조회 중 오류가 발생했습니다." });
    }
}
