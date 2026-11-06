export default async function handler(req, res) {
    const { corpName } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "API 키가 설정되지 않았습니다." });
    }

    try {
        const cleanName = corpName.trim();
        const baseUrl = "https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2";
        
        let itemList = [];

        // 1차 시도: corpNm 파라미터로 검색
        const url1 = `${baseUrl}?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=5&corpNm=${encodeURIComponent(cleanName)}`;
        let response = await fetch(url1);
        let text = await response.text();

        try {
            let data = JSON.parse(text);
            let items = data?.response?.body?.items?.item;
            if (Array.isArray(items)) itemList = items;
            else if (items) itemList = [items];
        } catch (e) {}

        // 2차 시도: 1차 결과가 없다면 enpNm(업체명) 파라미터로 재시도
        if (itemList.length === 0) {
            const url2 = `${baseUrl}?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=5&enpNm=${encodeURIComponent(cleanName)}`;
            response = await fetch(url2);
            text = await response.text();

            try {
                let data = JSON.parse(text);
                let items = data?.response?.body?.items?.item;
                if (Array.isArray(items)) itemList = items;
                else if (items) itemList = [items];
            } catch (e) {}
        }

        if (itemList.length > 0) {
            const target = itemList[0];
            return res.status(200).json({
                success: true,
                corpName: target.corpNm || target.enpNm || cleanName,
                ceoNm: target.ceoNm || "정보없음",
                bizno: target.bizNo || "정보없음",
                crno: target.crno || "정보없음",
                phone: target.enpTlno || "정보없음",
                address: target.enpBsadr || "정보없음",
                status: "계속사업자"
            });
        }

        return res.status(200).json({
            success: false,
            corpName: cleanName,
            ceoNm: "정보없음",
            bizno: "정보없음",
            crno: "정보없음",
            phone: "정보없음",
            address: "공공데이터 DB에 등록되지 않은 명칭이거나 정확한 법인명이 아닙니다.",
            status: "결과없음"
        });

    } catch (error) {
        return res.status(500).json({ error: "서버 내부 오류: " + error.message });
    }
}
